'use strict';
const el = id => document.getElementById(id);
const stage = el('play'), stick = stage.querySelector('.stick');
let brand = 'red', mode = 'shop', generation = 0, frame = 0, context, stream;
let left = 1, burning = false, previous = 0;
document.querySelectorAll('.choice').forEach(button => button.onclick = () => {
  brand = button.dataset.brand;
  document.querySelectorAll('.choice').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
});
function light(on) {
  if (burning === on) return;
  if (!on && left > 0 && !document.hidden) driftSmoke();
  burning = on;
  stick.classList.toggle('lit', on);
}
function driftSmoke() {
  const tip = stick.querySelector('.ember').getBoundingClientRect();
  const scene = stick.closest('.stage');
  const bounds = scene.getBoundingClientRect();
  const wisp = document.createElement('div');
  wisp.className = 'wisp';
  wisp.setAttribute('aria-hidden', 'true');
  wisp.style.left = (tip.left + tip.width / 2 - bounds.left) + 'px';
  wisp.style.top = (tip.top - bounds.top) + 'px';
  wisp.style.setProperty('--drift', (Math.random() * 20 - 10) + 'px');
  scene.append(wisp);
  wisp.addEventListener('animationend', () => wisp.remove(), {once:true});
}
function release() {
  generation++;
  cancelAnimationFrame(frame);
  burning = false;
  stick.classList.remove('lit');
  stage.querySelectorAll('.wisp').forEach(wisp => wisp.remove());
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  context?.close().catch(() => {});
  context = null;
}
function buttons() {
  el('hold').hidden = mode !== 'manual';
  el('again').hidden = mode !== 'done' && mode !== 'paused';
  el('again').textContent = mode === 'paused' ? '继续体验' : '再抽一支';
  el('manual').hidden = !['waiting','mic'].includes(mode);
}
function consume(dt) {
  if (!burning) return;
  left = Math.max(0, left - dt / 18000);
  stick.style.setProperty('--left', left);
  if (!left) {
    release(); mode = 'done'; buttons();
    el('status').textContent = '这一支已抽完。';
    stick.querySelector('.ember').hidden = true;
  }
}
function manual(message) {
  release(); mode = 'manual'; buttons();
  el('status').textContent = message;
  previous = performance.now();
  function tick(now) {
    consume(Math.min(80, now - previous)); previous = now;
    if (mode === 'manual') frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
async function start(resume = false) {
  release();
  const token = generation;
  if (!resume) left = 1;
  stick.style.setProperty('--left', left);
  stick.querySelector('.ember').hidden = false;
  el('shop').hidden = true; stage.hidden = false;
  stage.classList.toggle('green', brand === 'green');
  el('brand').textContent = brand === 'green' ? '钻石（荷花）' : '中华（硬）';
  mode = 'waiting'; buttons(); el('status').textContent = '允许麦克风后，就可以轻吸。';
  try {
    context = new (window.AudioContext || window.webkitAudioContext)();
    const ready = context.resume();
    ready.catch(() => {});
    const input = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if (token !== generation) {input.getTracks().forEach(t => t.stop()); return;}
    stream = input;
    stream.getAudioTracks()[0].onended = () => {if (token === generation) manual('麦克风已断开，按住按钮继续。');};
    await ready;
    if (token !== generation) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = .18;
    context.createMediaStreamSource(stream).connect(analyser);
    const wave = new Float32Array(1024), bins = new Float32Array(512);
    const hz = context.sampleRate / 1024;
    const samples = [];
    const began = performance.now();
    let floor = 0, onset = 0, lastHit = 0;
    mode = 'mic'; buttons(); el('status').textContent = '请安静一秒，正在测量环境音…';
    previous = began;
    function tick(now) {
      const dt = Math.min(80, now - previous); previous = now;
      analyser.getFloatTimeDomainData(wave); analyser.getFloatFrequencyData(bins);
      let squares = 0;
      for (const v of wave) squares += v*v;
      const rms = Math.sqrt(squares / wave.length);
      if (now - began < 1000 || !samples.length) samples.push(rms);
      else {
        if (!floor) {
          samples.sort((a,b) => a-b);
          floor = Math.max(.00025,samples[Math.floor(samples.length*.7)]);
          el('status').textContent = '靠近手机，轻轻吸一口。';
        }
        let total = 0, upper = 0, peak = 0;
        for (let i=Math.ceil(180/hz); i<bins.length && i*hz<8000; i++) {
          const power = 10 ** (bins[i]/10);
          total += power; peak = Math.max(peak,power);
          if (i*hz>1200) upper += power;
        }
        const hit = rms > Math.max(.0008,floor*(burning?1.55:2.1)) &&
          upper > total*.18 && peak < total*.22;
        if (hit) {onset += dt; lastHit = now;} else if (now-lastHit>75) onset = 0;
        if (!burning && onset>=145) light(true);
        if (burning && now-lastHit>135) light(false);
        if (!hit && rms<floor*1.6) floor = Math.max(.00025,floor*.995+rms*.005);
        consume(dt);
      }
      if (mode === 'mic') frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  } catch {
    if (token === generation) manual('麦克风不可用，按住按钮也可以试吸。');
  }
}
el('start').onclick = () => start();
el('again').onclick = () => start(mode === 'paused');
el('manual').onclick = () => manual('按住开始，松开即停。');
const hold = el('hold');
hold.onpointerdown = e => {if (e.isPrimary && mode === 'manual') {hold.setPointerCapture(e.pointerId); light(true);}};
hold.onlostpointercapture = hold.onpointercancel = hold.onpointerup = () => light(false);
hold.onkeydown = e => {if ([' ','Enter'].includes(e.key)) {e.preventDefault();light(true);}};
hold.onblur = hold.onkeyup = () => light(false);
el('back').onclick = () => {release(); mode='shop'; stage.hidden=true;el('shop').hidden=false;};
function pause() {
  if (['mic','manual','waiting'].includes(mode)) {
    release(); mode='paused'; buttons(); el('status').textContent='已暂停，进度已保留。';
  }
}
document.addEventListener('visibilitychange', () => {if (document.hidden) pause();});
window.addEventListener('pagehide', pause);

const gift = new URL(location.href).searchParams.get('gift');
if (['red', 'green'].includes(gift)) {
  document.querySelector('[data-brand="' + gift + '"]').click();
  el('shopTitle').textContent = '陪一根？';
  el('start').textContent = '陪你';
}
el('pass').onclick = async () => {
  const invitation = new URL(location.pathname, location.origin);
  invitation.searchParams.set('gift', brand);
  el('notice').textContent = '';
  el('copyLink').hidden = true;
  if (navigator.share) {
    try {
      await navigator.share({title:'陪一根？', text:'陪一根？', url:invitation.href});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText('陪一根？\n' + invitation.href);
    el('notice').textContent = '链接已复制，发给朋友就行。';
  } catch {
    el('notice').textContent = '长按复制链接，发给朋友。';
    const field = el('copyLink');
    field.hidden = false;
    field.value = invitation.href;
    field.select();
  }
};
