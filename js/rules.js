// Rule engine for the Compounding Technique Monitor.
// Pure functions + one small class, no DOM, so it can be unit-tested in Node.
// All coordinates are normalised (0..1) in DISPLAY space (already mirrored).

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Summary numbers for one hand (21 MediaPipe landmarks). */
export function handMetrics(lm) {
  const ids = [0, 5, 9, 13, 17];
  const c = { x: 0, y: 0 };
  for (const i of ids) { c.x += lm[i].x / ids.length; c.y += lm[i].y / ids.length; }
  const palm = dist(lm[0], lm[9]) || 1e-6;                 // wrist -> middle knuckle
  // 0° = fingers point straight up, +90° = point right, ±180° = point down.
  const angle = Math.atan2(lm[9].x - lm[0].x, -(lm[9].y - lm[0].y)) * 180 / Math.PI;
  return { center: c, palm, angle };
}

/** Smallest signed difference between two angles in degrees. */
export const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;

/**
 * Evaluates the rules of the current step against live hands.
 * A violation must persist for `rule.graceMs` before it is reported, and is
 * reported once per episode (it can fire again after it has cleared).
 */
export class RuleEngine {
  constructor() { this.reset(); }

  reset() {
    this.state = new Map();   // rule key -> { since, fired }
    this.history = new Map(); // hand label -> [{t, x, y, palm}]
    this.lastSeen = 0;
  }

  /**
   * @param {number} t           time in ms
   * @param {Array}  hands       [{label:'Left'|'Right', lm:[21 pts]}]
   * @param {Array}  rules       rule objects of the current step
   * @param {object} zone        {x,y,w,h} aseptic work zone
   * @returns {{active:Array, fired:Array}}  active = currently violating, fired = new this call
   */
  update(t, hands, rules, zone) {
    const metrics = hands.map(h => ({ label: h.label, ...handMetrics(h.lm) }));
    if (metrics.length) this.lastSeen = t;
    for (const m of metrics) {
      const h = this.history.get(m.label) ?? [];
      h.push({ t, x: m.center.x, y: m.center.y, palm: m.palm });
      while (h.length && t - h[0].t > 1500) h.shift();
      this.history.set(m.label, h);
    }
    for (const label of [...this.history.keys()]) {
      if (!metrics.some(m => m.label === label)) this.history.delete(label);
    }

    const active = [], fired = [];
    rules.forEach((rule, i) => {
      const key = rule.id ?? `${rule.type}-${i}`;
      const bad = this.check(rule, t, metrics, zone);
      const s = this.state.get(key) ?? { since: null, fired: false };
      if (bad) {
        s.since ??= t;
        if (t - s.since >= (rule.graceMs ?? 400)) {
          active.push({ rule, key, detail: bad });
          if (!s.fired) { s.fired = true; fired.push({ rule, key, detail: bad }); }
        }
      } else { s.since = null; s.fired = false; }
      this.state.set(key, s);
    });
    return { active, fired };
  }

  /** Returns a short detail string if the rule is currently broken, else null. */
  check(rule, t, metrics, zone) {
    switch (rule.type) {
      case 'zone': {
        const out = metrics.filter(m => {
          const { x, y } = m.center;
          return x < zone.x || x > zone.x + zone.w || y < zone.y || y > zone.y + zone.h;
        });
        return out.length ? `${out.map(m => m.label).join(' & ')} hand outside the work zone` : null;
      }
      case 'hands': {
        const n = metrics.length;
        if (rule.min != null && n < rule.min) return `${n} hand(s) visible, need ${rule.min}`;
        if (rule.max != null && n > rule.max) return `${n} hand(s) visible, max ${rule.max}`;
        return null;
      }
      case 'steady': {
        for (const m of metrics) {
          const h = this.history.get(m.label) ?? [];
          if (h.length < 6 || h[h.length - 1].t - h[0].t < (rule.windowMs ?? 700)) continue;
          const mx = h.reduce((a, p) => a + p.x, 0) / h.length;
          const my = h.reduce((a, p) => a + p.y, 0) / h.length;
          const jitter = h.reduce((a, p) => a + Math.hypot(p.x - mx, p.y - my), 0) / h.length / m.palm;
          if (jitter > rule.maxJitter) return `${m.label} hand unsteady (${jitter.toFixed(2)} palm-widths)`;
        }
        return null;
      }
      case 'speed': {
        for (const m of metrics) {
          const h = this.history.get(m.label) ?? [];
          if (h.length < 3) continue;
          const a = h[Math.max(0, h.length - 4)], b = h[h.length - 1];
          const dt = (b.t - a.t) / 1000;
          if (dt <= 0) continue;
          const v = Math.hypot(b.x - a.x, b.y - a.y) / m.palm / dt;
          if (v > rule.maxSpeed) return `${m.label} hand moving too fast (${v.toFixed(1)} palm/s)`;
        }
        return null;
      }
      case 'posture': {
        for (const m of metrics) {
          if (Math.abs(angleDiff(m.angle, rule.angle)) > rule.tolerance)
            return `${m.label} hand angle ${Math.round(m.angle)}°, expected ${rule.angle}°±${rule.tolerance}°`;
        }
        return null;
      }
      case 'visible': {
        return metrics.length === 0 && t - this.lastSeen > (rule.graceMs ?? 400) ? 'hands out of camera view' : null;
      }
      default: return null;
    }
  }
}

/** Duration checks happen when a step is finished. Returns a message or null. */
export function checkDuration(step, elapsedMs) {
  const s = elapsedMs / 1000;
  if (step.minSeconds != null && s < step.minSeconds) return `Step finished too quickly (${s.toFixed(0)}s, min ${step.minSeconds}s)`;
  if (step.maxSeconds != null && s > step.maxSeconds) return `Step took too long (${s.toFixed(0)}s, max ${step.maxSeconds}s)`;
  return null;
}
