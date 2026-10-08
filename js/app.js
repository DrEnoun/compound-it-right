// Compounding Technique Monitor: webcam + MediaPipe Hands (reuses ../vendor) + rule engine.
import { RuleEngine, checkDuration, checkActive } from './rules.js';

const VENDOR = 'vendor/mediapipe-hands/';
const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const SEV_COLOR = { info: '#2dd4bf', warn: '#fbbf24', error: '#f87171' };
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const engine = new RuleEngine();
let protocol, zone, hands = [], stepIdx = 0, session = null, stepStart = 0, hl = null;
let alertUntil = 0;

async function loadProtocol(file) {
  if (!file) {
    const list = await (await fetch('data/protocols/index.json')).json();
    $('protocol-select').innerHTML = list.map(p => `<option value="${p.file}">${p.title}</option>`).join('');
    file = list[0].file;
  }
  protocol = await (await fetch('data/protocols/' + file)).json();
  stepIdx = 0; session = null; $('btn-start').disabled = !video.srcObject; $('btn-export').disabled = true;
  try { zone = JSON.parse(localStorage.getItem('cm-zone')); } catch { /* ignore */ }
  zone ??= protocol.zone;
  $('protocol-name').textContent = protocol.name;
  $('steps').innerHTML = protocol.steps.map(s => `<li>${s.title}</li>`).join('');
  renderStep();
}

function renderStep() {
  [...$('steps').children].forEach((li, i) => {
    li.className = !session ? '' : i < stepIdx ? 'done' : i === stepIdx ? 'current' : '';
  });
  $('instruction').textContent = session ? protocol.steps[stepIdx].instruction : 'Press “Start session” when the student is ready.';
  $('btn-prev').disabled = !session || stepIdx === 0;
  $('btn-next').textContent = stepIdx === protocol.steps.length - 1 ? 'Finish' : 'Next step →';
  $('btn-next').disabled = !session;
}

function fmt(ms) { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function logEvent(severity, message, detail) {
  if (!session) return;
  const step = protocol.steps[stepIdx];
  const ev = { tMs: performance.now() - session.t0, step: step.id, severity, message, detail };
  session.events.push(ev);
  const li = document.createElement('li');
  li.className = severity;
  li.innerHTML = `<b></b><small></small>`;
  li.firstChild.textContent = message;
  li.lastChild.textContent = `${fmt(ev.tMs)} · ${step.title}${detail ? ' · ' + detail : ''}`;
  $('log').prepend(li);
  const n = session.events.filter(e => e.severity !== 'info' && e.step !== 'duration').length;
  $('score').textContent = `(${n} flag${n === 1 ? '' : 's'})`;
}

function showAlert(severity, text) {
  const el = $('alert');
  el.className = `alert ${severity}`; el.textContent = text; el.hidden = false;
  alertUntil = performance.now() + 2500;
}

function startSession() {
  session = { t0: performance.now(), student: $('student').value.trim(), events: [], stepTimes: [] };
  stepIdx = 0; stepStart = performance.now(); engine.reset();
  $('log').innerHTML = ''; $('score').textContent = '(0 flags)';
  $('btn-start').disabled = true; $('btn-export').disabled = false;
  renderStep();
}

function nextStep(delta) {
  if (!session) return;
  if (delta > 0) {
    const step = protocol.steps[stepIdx];
    const now = performance.now();
    for (const msg of [checkDuration(step, now - stepStart), checkActive(step, engine.activeMs)]) {
      if (msg) { logEvent('warn', msg); showAlert('warn', msg); }
    }
    session.stepTimes.push({ step: step.id, ms: now - stepStart });
    if (stepIdx === protocol.steps.length - 1) {
      session.endedMs = now - session.t0; stepIdx = protocol.steps.length;
      renderStep(); $('instruction').textContent = 'Session finished. Export the report.';
      $('btn-next').disabled = true; $('btn-prev').disabled = true; $('btn-start').disabled = false;
      return;
    }
  }
  stepIdx = Math.max(0, stepIdx + delta);
  stepStart = performance.now(); engine.reset(); renderStep();
}

function exportReport() {
  const r = { protocol: protocol.name, student: session.student, date: new Date().toISOString(), zone,
              stepTimes: session.stepTimes, events: session.events };
  const rows = [['time', 'step', 'severity', 'message', 'detail'],
    ...session.events.map(e => [fmt(e.tMs), e.step, e.severity, e.message, e.detail ?? ''])];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  for (const [name, type, body] of [['json', 'application/json', JSON.stringify(r, null, 2)], ['csv', 'text/csv', csv]]) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = `compounding-${(session.student || 'session').replace(/\W+/g, '_')}-${Date.now()}.${name}`;
    a.click(); URL.revokeObjectURL(a.href);
  }
}

// ---------- camera + hands ----------
async function startCamera() {
  $('btn-camera').disabled = true; $('btn-camera').textContent = 'Starting…';
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    await video.play();
    await loadScript(VENDOR + 'hands.js');
    const h = new window.Hands({ locateFile: f => VENDOR + f });
    h.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    h.onResults(onResults);
    $('placeholder').classList.add('gone');
    $('btn-camera').textContent = 'Camera on'; $('btn-start').disabled = false;
    const loop = async () => {
      if (video.readyState >= 2) await h.send({ image: video });
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $('btn-camera').disabled = false; $('btn-camera').textContent = 'Turn on camera';
    $('placeholder').textContent = 'Camera unavailable: ' + (e.message || e.name);
  }
}
const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
  document.head.append(s);
});

function onResults(res) {
  const t = performance.now();
  // Mirror x so landmarks match the mirrored video the student sees.
  hands = (res.multiHandLandmarks ?? []).map((lm, i) => ({
    label: res.multiHandedness?.[i]?.label ?? `H${i}`,
    lm: lm.map(p => ({ x: 1 - p.x, y: p.y, z: p.z })),
  }));
  // MediaPipe handedness is from the un-mirrored image; flip so labels match what the student sees.
  hands.forEach(h => { h.label = h.label === 'Left' ? 'Right' : h.label === 'Right' ? 'Left' : h.label; });
  let active = [];
  if (session && stepIdx < protocol.steps.length) {
    const out = engine.update(t, hands, protocol.steps[stepIdx].rules, zone);
    active = out.active;
    for (const f of out.fired) { logEvent(f.rule.severity, f.rule.message, f.detail); showAlert(f.rule.severity, f.rule.message); }
  }
  draw(active);
}

function draw(active) {
  const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const zoneBad = active.some(a => a.rule.type === 'zone');
  ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
  ctx.strokeStyle = zoneBad ? SEV_COLOR.error : '#2dd4bf';
  ctx.strokeRect(zone.x * w, zone.y * h, zone.w * w, zone.h * h); ctx.setLineDash([]);
  const color = active.length ? SEV_COLOR[active.some(a => a.rule.severity === 'error') ? 'error' : 'warn'] : '#4ade80';
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
  for (const hand of hands) {
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath(); ctx.moveTo(hand.lm[a].x * w, hand.lm[a].y * h); ctx.lineTo(hand.lm[b].x * w, hand.lm[b].y * h); ctx.stroke();
    }
    for (const p of hand.lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3, 0, 7); ctx.fill(); }
  }
  if (performance.now() > alertUntil) $('alert').hidden = true;
}

// Drag on the overlay to redraw the work zone.
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const x0 = (e.clientX - r.left) / r.width, y0 = (e.clientY - r.top) / r.height;
  canvas.setPointerCapture(e.pointerId);
  const move = ev => {
    const x1 = (ev.clientX - r.left) / r.width, y1 = (ev.clientY - r.top) / r.height;
    zone = { x: Math.max(0, Math.min(x0, x1)), y: Math.max(0, Math.min(y0, y1)),
             w: Math.min(1, Math.abs(x1 - x0)), h: Math.min(1, Math.abs(y1 - y0)) };
    if (!hands.length) draw([]);
  };
  const up = () => {
    canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
    if (zone.w < 0.1 || zone.h < 0.1) zone = protocol.zone;
    try { localStorage.setItem('cm-zone', JSON.stringify(zone)); } catch { /* ignore */ }
  };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
});

$('protocol-select').onchange = async e => {
  if (session && !confirm('Leave this session? Unexported results will be lost.')) { e.target.value = e.target.dataset.cur; return; }
  e.target.dataset.cur = e.target.value; await loadProtocol(e.target.value); draw([]);
};
$('btn-camera').onclick = startCamera;
$('btn-start').onclick = startSession;
$('btn-next').onclick = () => nextStep(1);
$('btn-prev').onclick = () => nextStep(-1);
$('btn-export').onclick = exportReport;
loadProtocol().then(() => { $('protocol-select').dataset.cur = $('protocol-select').value; draw([]); });
