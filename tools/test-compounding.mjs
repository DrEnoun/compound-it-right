// Unit test for the Compounding Monitor rule engine with synthetic hands. Run: node tools/test-compounding.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { RuleEngine, handMetrics, angleDiff, checkDuration, checkActive } from '../js/rules.js';

// Hand with wrist at (cx,cy) and middle knuckle `palm` away at `deg` (0 = up).
function hand(cx, cy, deg = 0, palm = 0.12, label = 'Right') {
  const r = deg * Math.PI / 180;
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[9] = { x: cx + Math.sin(r) * palm, y: cy - Math.cos(r) * palm, z: 0 };
  for (const i of [5, 13, 17]) lm[i] = { ...lm[9] };
  return { label, lm };
}
const zone = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
const run = (rules, frames) => {
  const e = new RuleEngine(); let last, fired = [];
  frames.forEach(([t, hs]) => { last = e.update(t, hs, rules, zone); fired.push(...last.fired); });
  return { last, fired };
};
const ticks = (from, to, fn) => { const o = []; for (let t = from; t <= to; t += 50) o.push([t, fn(t)]); return o; };

// metrics
assert.ok(Math.abs(handMetrics(hand(0.5, 0.7, 0).lm).angle) < 1e-6);
assert.ok(Math.abs(handMetrics(hand(0.5, 0.7, 90).lm).angle - 90) < 1e-6);
assert.equal(Math.round(angleDiff(170, -170)), -20);

// zone: inside is fine, outside fires once after grace
let r = run([{ type: 'zone', graceMs: 300 }], ticks(0, 1000, () => [hand(0.5, 0.6)]));
assert.equal(r.fired.length, 0);
r = run([{ type: 'zone', graceMs: 300 }], ticks(0, 1000, () => [hand(0.95, 0.6)]));
assert.equal(r.fired.length, 1, 'fires once per episode');
assert.equal(r.last.active.length, 1);
// brief excursion shorter than grace does not fire
r = run([{ type: 'zone', graceMs: 300 }], ticks(0, 1000, t => [hand(t < 200 ? 0.95 : 0.5, 0.6)]));
assert.equal(r.fired.length, 0);
// re-fires after clearing
r = run([{ type: 'zone', graceMs: 100 }], ticks(0, 1500, t => [hand(t > 400 && t < 800 ? 0.95 : 0.5, 0.6)]));
assert.equal(r.fired.length, 1);
r = run([{ type: 'zone', graceMs: 100 }], ticks(0, 2000, t => [hand(t % 1000 > 400 && t % 1000 < 700 ? 0.95 : 0.5, 0.6)]));
assert.equal(r.fired.length, 2);

// hands count
r = run([{ type: 'hands', min: 2, graceMs: 200 }], ticks(0, 600, () => [hand(0.5, 0.6)]));
assert.equal(r.fired.length, 1);
r = run([{ type: 'hands', min: 2, graceMs: 200 }], ticks(0, 600, () => [hand(0.4, 0.6, 0, 0.12, 'Left'), hand(0.6, 0.6)]));
assert.equal(r.fired.length, 0);

// posture
r = run([{ type: 'posture', angle: 0, tolerance: 30, graceMs: 200 }], ticks(0, 600, () => [hand(0.5, 0.6, 90)]));
assert.equal(r.fired.length, 1);
r = run([{ type: 'posture', angle: 0, tolerance: 30, graceMs: 200 }], ticks(0, 600, () => [hand(0.5, 0.6, 10)]));
assert.equal(r.fired.length, 0);

// steady vs shaking
const shake = t => [hand(0.5 + (Math.floor(t / 50) % 2 ? 0.05 : -0.05), 0.6)];
r = run([{ type: 'steady', maxJitter: 0.3, windowMs: 700, graceMs: 100 }], ticks(0, 2000, shake));
assert.equal(r.fired.length, 1);
r = run([{ type: 'steady', maxJitter: 0.3, windowMs: 700, graceMs: 100 }], ticks(0, 2000, () => [hand(0.5, 0.6)]));
assert.equal(r.fired.length, 0);

// speed
r = run([{ type: 'speed', maxSpeed: 2.5, graceMs: 100 }], ticks(0, 1000, t => [hand(0.2 + t / 1000 * 0.6, 0.6)])); // 0.6/s = 5 palm/s
assert.equal(r.fired.length, 1);
r = run([{ type: 'speed', maxSpeed: 2.5, graceMs: 100 }], ticks(0, 1000, t => [hand(0.4 + t / 1000 * 0.1, 0.6)])); // ~0.8 palm/s
assert.equal(r.fired.length, 0);

// visible
r = run([{ type: 'visible', graceMs: 500 }], [...ticks(0, 200, () => [hand(0.5, 0.6)]), ...ticks(250, 1500, () => [])]);
assert.equal(r.fired.length, 1);

// duration
assert.match(checkDuration({ minSeconds: 5 }, 2000), /too quickly/);
assert.match(checkDuration({ maxSeconds: 5 }, 9000), /too long/);
assert.equal(checkDuration({ minSeconds: 5 }, 6000), null);

// shake vs gentle swirl vs idle
const SHAKE = { type: 'shake', maxHz: 2.5, minAmp: 0.3, graceMs: 100 };
const circle = (hz, rad) => t => [hand(0.5 + rad * Math.cos(2 * Math.PI * hz * t / 1000), 0.6 + rad * Math.sin(2 * Math.PI * hz * t / 1000))];
r = run([SHAKE], ticks(0, 3000, t => [hand(0.5, 0.6 + 0.04 * Math.sin(2 * Math.PI * 5 * t / 1000))])); // ~5 Hz, 0.33 palm amp
assert.equal(r.fired.length, 1, 'shaking at 5 Hz is flagged');
r = run([SHAKE], ticks(0, 3000, circle(1, 0.05)));
assert.equal(r.fired.length, 0, 'gentle swirl at 1 Hz is not shaking');
r = run([SHAKE], ticks(0, 3000, t => [hand(0.5, 0.6 + 0.004 * Math.sin(2 * Math.PI * 6 * t / 1000))]));
assert.equal(r.fired.length, 0, 'tiny tremor below minAmp is ignored');

const CIRC = { type: 'circular', windowMs: 2500, minTurns: 1, minRadius: 0.15, maxRadius: 2, graceMs: 500 };
r = run([CIRC], ticks(0, 5000, circle(1, 0.06)));
assert.equal(r.fired.length, 0, 'circling hand satisfies circular rule');
r = run([CIRC], ticks(0, 5000, circle(1, 0.06)).concat(ticks(5050, 9000, () => [hand(0.5, 0.6)])));
assert.equal(r.fired.length, 1, 'stopping is flagged');
r = run([CIRC], ticks(0, 5000, t => [hand(0.3 + 0.4 * (t / 5000), 0.6)]));
assert.equal(r.fired.length, 1, 'straight-line motion is not circling');
r = run([CIRC], ticks(0, 5000, circle(1, 0.005)));
assert.equal(r.fired.length, 1, 'tiny jitter is not circling');

// active time accumulates only while circling
{
  const e = new RuleEngine();
  ticks(0, 6000, circle(1, 0.06)).forEach(([t, hs]) => e.update(t, hs, [CIRC], zone));
  assert.ok(e.activeMs > 2500 && e.activeMs < 6000, 'activeMs ' + e.activeMs);
  e.reset(); assert.equal(e.activeMs, 0);
}
assert.match(checkActive({ minActiveSeconds: 10 }, 4000), /Only 4s/);
assert.equal(checkActive({ minActiveSeconds: 10 }, 11000), null);
assert.equal(checkActive({}, 0), null);

// every shipped protocol is well-formed and listed
const dir = new URL('../data/protocols/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir)));
const files = readdirSync(dir).filter(f => f !== 'index.json').sort();
assert.deepEqual(index.map(i => i.file).sort(), files, 'index.json lists every protocol');
const types = new Set(['zone', 'hands', 'steady', 'speed', 'posture', 'visible', 'shake', 'circular']);
for (const { file } of index) {
  const p = JSON.parse(readFileSync(new URL(file, dir)));
  assert.ok(p.name && p.zone && p.steps.length, file);
  for (const st of p.steps) {
    assert.ok(st.id && st.title && st.instruction, `${file}/${st.id}`);
    for (const rule of st.rules) {
      assert.ok(types.has(rule.type), `${file}/${st.id}: unknown rule ${rule.type}`);
      assert.ok(['info', 'warn', 'error'].includes(rule.severity) && rule.message, `${file}/${st.id}`);
    }
    if (st.minActiveSeconds) assert.ok(st.rules.some(x => x.type === 'circular'), `${file}/${st.id}: minActiveSeconds needs a circular rule`);
  }
}
console.log('compounding monitor: all tests passed');
