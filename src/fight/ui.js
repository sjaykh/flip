// Fight mode UI: DOM, timers, effects and sound. Game rules live in logic.js,
// copy and numbers in constants.js. build.mjs inlines all three into one script.
import {
  MAX_HP, TIMING, MOVES, FEELINGS, COPY, TAUNTS,
} from './constants.js';
import {
  computeDamage, startingHp, applyDamage, afterBreather, idleGrowth, trackCombo,
  finisherDamage, tauntAt, blobLook, formatDuration,
} from './logic.js';

export function initFight(api) {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Tests may speed time up; real users always get 1.
  const timeScale = Math.max(1, Number(window.__flipTimeScale) || 1);
  const clock = () => performance.now() * timeScale;
  const later = (fn, ms) => setTimeout(fn, ms / timeScale);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const el = {
    thought: $('#f-thought'),
    strength: $('#f-strength'),
    strengthOut: $('#f-strength-out'),
    previewBlob: $('#f-preview-blob'),
    previewHp: $('#f-preview-hp'),
    previewQuote: $('#f-preview-quote'),
    stage: $('#f-stage'),
    blob: $('#f-blob'),
    player: $('#f-player'),
    bubble: $('#f-bubble'),
    hpNum: $('#f-hp-num'),
    hpBar: $('#f-hpbar'),
    hpFill: $('#f-hp-fill'),
    timer: $('#f-timer'),
    sound: $('#f-sound'),
    helpBtn: $('#f-help-btn'),
    help: $('#f-help'),
    rules: $('#f-rules'),
    feedback: $('#f-feedback'),
    moves: $('#f-moves'),
    finisher: $('#f-finisher'),
    form: $('#f-form'),
    line: $('#f-line'),
    lineLabel: $('#f-line-label'),
    inputArea: $('#f-input-area'),
    ko: $('#f-ko'),
    koMsg: $('#f-ko-msg'),
    dmgLayer: $('#f-dmg-layer'),
    banner: $('#f-banner'),
    breathe: $('#f-breathe'),
    breatheMsg: $('#f-breathe-msg'),
    breathePhase: $('#f-breathe-phase'),
    breatheCount: $('#f-breathe-count'),
    after: $('#f-after'),
    afterOut: $('#f-after-out'),
    feelings: $('#f-feelings'),
  };

  const fresh = () => ({
    screen: null,
    thought: '',
    strength: 50,
    after: 50,
    afterTouched: false,
    feeling: null,
    hp: 50,
    phase: 'idle', // idle | intro | fight | breathing | ko
    move: MOVES[0].id,
    log: [],       // { move, line, damage, verdict }
    used: new Set(),
    finisherReady: false,
    finisherUsed: false,
    breaks: 0,
    tauntIndex: 0,
    startedAt: 0,
    endedAt: 0,
    pausedMs: 0,
    lastActivityAt: 0,
    lastGrowthAt: 0,
    finishedAt: null,
    downloaded: false,
  });
  let s = fresh();
  let tickTimer = null;
  let tauntTimer = null;
  const pending = new Set();

  function schedule(fn, ms) {
    const id = later(() => { pending.delete(id); fn(); }, ms);
    pending.add(id);
    return id;
  }
  function clearAllTimers() {
    clearInterval(tickTimer);
    clearInterval(tauntTimer);
    tickTimer = tauntTimer = null;
    pending.forEach(clearTimeout);
    pending.clear();
  }

  // ---------- Build dynamic bits from constants ----------

  COPY.rules.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = r;
    el.rules.appendChild(li);
  });

  MOVES.forEach((m, i) => {
    const label = document.createElement('label');
    label.className = 'move';
    label.dataset.move = m.id;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'f-move';
    input.value = m.id;
    input.checked = i === 0;
    const name = document.createElement('span');
    name.className = 'move-name';
    name.textContent = m.name;
    const tick = document.createElement('span');
    tick.className = 'move-tick';
    tick.setAttribute('aria-hidden', 'true');
    label.append(input, name, tick);
    el.moves.appendChild(label);
  });

  FEELINGS.forEach((f) => {
    const label = document.createElement('label');
    label.className = 'feeling';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'f-feeling';
    input.value = String(f.value);
    const face = document.createElement('span');
    face.className = `feeling-face f${f.value}`;
    face.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = f.label;
    label.append(input, face, text);
    el.feelings.appendChild(label);
  });

  // ---------- Setup ----------

  function thoughtGate() {
    const n = el.thought.value.trim().length;
    const hint = n === 0 ? COPY.thoughtHints.empty : n < 20 ? COPY.thoughtHints.short : COPY.thoughtHints.ok;
    const h = $('#hint-f1');
    if (h.textContent !== hint) h.textContent = hint;
    h.classList.toggle('ready', n >= 20);
    $('[data-fgate="f1"]').setAttribute('aria-disabled', String(n < 20));
    return n >= 20;
  }

  function feelingGate() {
    const ok = s.feeling !== null;
    const h = $('#hint-f5');
    const hint = ok ? '' : 'Pick the one that fits best. There are no wrong answers.';
    if (h.textContent !== hint) h.textContent = hint;
    $('[data-fgate="f5"]').setAttribute('aria-disabled', String(!ok));
    return ok;
  }

  function nudge(hintSel, focusEl) {
    const h = $(hintSel);
    h.classList.remove('nudge');
    void h.offsetWidth;
    h.classList.add('nudge');
    if (focusEl) focusEl.focus();
  }

  function setRange(input, out, v) {
    input.value = String(v);
    out.textContent = String(v);
    input.setAttribute('aria-valuetext', `${v} out of 100`);
    input.style.setProperty('--fill', v + '%');
  }

  function paintBlob(wrap, hp) {
    const { scale, darkness } = blobLook(hp);
    wrap.style.setProperty('--blob-scale', scale.toFixed(3));
    // Lerp from a soft lilac to a near-black violet as it gets stronger.
    const a = [150, 138, 184];
    const b = [38, 26, 56];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * darkness));
    wrap.style.setProperty('--blob-fill', `rgb(${c.join(' ')})`);
  }

  function updatePreview() {
    const hp = startingHp(s.strength);
    el.previewHp.textContent = String(hp);
    paintBlob(el.previewBlob, hp);
    el.previewQuote.textContent = `“${s.thought.trim()}”`;
  }

  // ---------- Screens ----------

  function show(id) {
    s.screen = id;
    const inArena = id === 'f3';
    document.body.classList.toggle('arena-mode', inArena);
    api.showScreen(id, { back: id === 'f1' || id === 'f2' || id === 'f5' || id === 'f6' });
    if (inArena) syncViewport();
  }

  function start() {
    api.setMode('fight');
    show('f1');
    thoughtGate();
  }

  function back() {
    const map = { f1: () => api.home(), f2: () => show('f1'), f5: () => show('f4'), f6: () => show('f5') };
    (map[s.screen] || (() => {}))();
  }

  function isDirty() {
    return s.thought.trim().length > 0 && !s.downloaded;
  }

  function touch() {
    s.downloaded = false;
    s.finishedAt = null;
    api.refreshDirty();
  }

  // ---------- Fight loop ----------

  function setHp(hp) {
    s.hp = hp;
    el.hpNum.textContent = String(hp);
    el.hpBar.setAttribute('aria-valuenow', String(hp));
    el.hpFill.style.width = hp + '%';
    el.hpFill.classList.toggle('danger', hp >= 85);
    paintBlob(el.blob, hp);
  }

  function fightElapsed(now = clock()) {
    const end = s.phase === 'ko' ? s.endedAt : now;
    return Math.max(0, end - s.startedAt);
  }

  function setInputsEnabled(on) {
    el.line.disabled = !on;
    el.form.querySelector('button').disabled = !on;
    $$('input[name="f-move"]').forEach((i) => { i.disabled = !on; });
    el.finisher.disabled = !on;
  }

  let bannerTimer = null;
  function showBanner(text, ms, cls = '') {
    // A newer banner (e.g. K.O.) must not be cleared by an older one's timer.
    if (bannerTimer) { clearTimeout(bannerTimer); pending.delete(bannerTimer); bannerTimer = null; }
    el.banner.textContent = text;
    el.banner.className = `banner show ${cls}`.trim();
    if (ms) bannerTimer = schedule(() => { el.banner.className = 'banner'; bannerTimer = null; }, ms);
  }

  function setFeedback(text, tone = '') {
    el.feedback.textContent = text;
    el.feedback.className = `f-feedback ${tone}`.trim();
  }

  function setBubble(text) {
    el.bubble.textContent = text;
    el.bubble.classList.remove('pop');
    void el.bubble.offsetWidth;
    el.bubble.classList.add('pop');
  }

  function selectMove(id) {
    s.move = id;
    const m = MOVES.find((x) => x.id === id);
    el.line.placeholder = m.prompt;
    el.lineLabel.textContent = `${m.name}: ${m.prompt}`;
    $$('.move').forEach((l) => l.classList.toggle('selected', l.dataset.move === id));
  }

  function refreshMoveTicks() {
    $$('.move').forEach((l) => l.classList.toggle('landed', s.used.has(l.dataset.move)));
  }

  function enterArena() {
    clearAllTimers();
    s.hp = startingHp(s.strength);
    s.log = [];
    s.used = new Set();
    s.finisherReady = false;
    s.finisherUsed = false;
    s.breaks = 0;
    s.tauntIndex = 0;
    s.feeling = null;
    s.afterTouched = false;
    s.phase = 'intro';
    s.startedAt = 0;
    s.endedAt = 0;

    el.blob.classList.remove('ko', 'hit');
    el.inputArea.hidden = false;
    el.ko.hidden = true;
    el.finisher.hidden = true;
    el.help.hidden = true;
    el.helpBtn.setAttribute('aria-expanded', 'false');
    el.breathe.hidden = true;
    el.line.value = '';
    el.dmgLayer.textContent = '';
    el.timer.textContent = '0:00';
    setHp(s.hp);
    refreshMoveTicks();
    const first = $$('input[name="f-move"]')[0];
    first.checked = true;
    selectMove(first.value);
    setBubble(s.thought.trim());
    setFeedback(COPY.pickMove);
    setInputsEnabled(false);

    show('f3');
    showBanner(COPY.round, TIMING.bannerMs, 'round');
    sfx('round');
    schedule(() => {
      showBanner(COPY.fight, TIMING.bannerMs, 'go');
      sfx('fight');
      s.phase = 'fight';
      s.startedAt = clock();
      s.lastActivityAt = s.startedAt;
      s.lastGrowthAt = s.startedAt;
      setInputsEnabled(true);
      tickTimer = setInterval(tick, TIMING.tickMs / timeScale);
      tauntTimer = setInterval(taunt, TIMING.tauntMs / timeScale);
    }, TIMING.bannerMs + 150);
  }

  function tick() {
    const now = clock();
    if (s.phase === 'fight' || s.phase === 'breathing') el.timer.textContent = formatDuration(fightElapsed(now));
    if (s.phase !== 'fight') return;
    const g = idleGrowth(s, now);
    if (!g.grew) return;
    s.lastGrowthAt = g.lastGrowthAt;
    setHp(g.hp);
    if (g.maxed) startBreather();
  }

  function taunt() {
    if (s.phase !== 'fight') return;
    s.tauntIndex += 1;
    setBubble(tauntAt(s.tauntIndex, s.thought.trim(), TAUNTS));
  }

  function activity() {
    s.lastActivityAt = clock();
  }

  // ---------- Breathing interlude (no game over) ----------

  function startBreather() {
    s.phase = 'breathing';
    s.breaks += 1;
    const hadFocus = document.activeElement === el.line;
    setInputsEnabled(false);
    el.breathe.hidden = false;
    el.breathe.style.setProperty('--phase-ms', `${TIMING.breathPhaseMs / timeScale}ms`);
    el.breatheMsg.textContent = COPY.breatheMessage;
    setFeedback(COPY.breatheMessage);
    el.breatheMsg.focus({ preventScroll: true });
    sfx('breathe');

    const phases = COPY.breathPhases;
    const total = phases.length * TIMING.breathCycles;
    let i = 0;
    const runPhase = () => {
      if (i >= total) return endBreather(hadFocus);
      const p = i % phases.length;
      el.breathe.dataset.phase = String(p);
      el.breathePhase.textContent = phases[p];
      let left = TIMING.breathPhaseMs / 1000;
      el.breatheCount.textContent = String(left);
      for (let k = 1; k < left; k++) {
        schedule(() => { el.breatheCount.textContent = String(left - k); }, k * 1000);
      }
      i += 1;
      schedule(runPhase, TIMING.breathPhaseMs);
    };
    runPhase();
  }

  function endBreather(refocus) {
    el.breathe.hidden = true;
    delete el.breathe.dataset.phase;
    setHp(afterBreather(s.hp));
    s.phase = 'fight';
    s.lastActivityAt = clock();
    s.lastGrowthAt = s.lastActivityAt;
    setInputsEnabled(true);
    setFeedback(COPY.breatheDone, 'good');
    if (refocus) el.line.focus();
  }

  // ---------- Attacks ----------

  function attack() {
    if (s.phase !== 'fight') return;
    activity();
    const line = el.line.value.trim();
    if (!line) {
      setFeedback(COPY.empty);
      el.line.focus();
      return;
    }
    const previous = s.log.map((l) => l.line);
    const res = computeDamage(line, previous);
    const move = MOVES.find((m) => m.id === s.move);
    el.line.value = '';
    touch();

    if (res.verdict === 'repeat') {
      setFeedback(COPY.repeat, 'soft');
      popNumber('0', 'miss');
      sfx('miss');
      return;
    }

    s.log.push({ move: move.id, line, damage: res.damage, verdict: res.verdict });
    const combo = trackCombo(s.used, move.id, res.verdict);
    s.used = combo.used;
    refreshMoveTicks();

    if (res.verdict === 'vague') {
      setFeedback(`${COPY.vague} (${res.damage})`, 'soft');
    } else {
      const extra = res.reasons.length ? ` · bonus: ${res.reasons.join(', ')}` : '';
      setFeedback(`${move.name}! ${res.damage} damage${extra}`, 'good');
    }
    land(res.damage, res.verdict === 'vague' ? 'weak' : 'hit');

    if (combo.unlocked && !s.finisherReady && !s.finisherUsed && s.phase === 'fight') {
      s.finisherReady = true;
      el.finisher.hidden = false;
      showBanner(COPY.finisherName, TIMING.bannerMs, 'combo');
      setFeedback(COPY.finisherReady, 'good');
      sfx('combo');
    }
  }

  function useFinisher() {
    if (s.phase !== 'fight' || !s.finisherReady || s.finisherUsed) return;
    activity();
    s.finisherUsed = true;
    s.finisherReady = false;
    el.finisher.hidden = true;
    const dmg = finisherDamage();
    s.log.push({ move: 'finisher', line: COPY.finisherName, damage: dmg, verdict: 'finisher' });
    setFeedback(`${COPY.finisherName}! ${dmg} damage`, 'good');
    showBanner(COPY.finisherName, TIMING.bannerMs, 'combo');
    land(dmg, 'big');
    touch();
    if (s.phase === 'fight') el.line.focus();
  }

  function land(dmg, kind) {
    setHp(applyDamage(s.hp, dmg));
    popNumber(kind === 'big' ? `−${dmg}!` : `−${dmg}`, kind);
    sfx(kind);
    if (!reducedMotion.matches) {
      restartClass(el.player, 'attack');
      if (dmg > 0) restartClass(el.blob, 'hit');
      if (dmg >= 8) restartClass(el.stage, kind === 'big' ? 'shake-big' : 'shake');
    }
    if (s.hp <= 0) knockOut();
  }

  function restartClass(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function popNumber(text, kind) {
    const n = document.createElement('span');
    n.className = `dmg ${kind}`;
    n.textContent = text;
    el.dmgLayer.appendChild(n);
    later(() => n.remove(), 1100);
  }

  function knockOut() {
    s.phase = 'ko';
    s.endedAt = clock();
    clearInterval(tickTimer);
    clearInterval(tauntTimer);
    el.timer.textContent = formatDuration(fightElapsed());
    setInputsEnabled(false);
    el.blob.classList.add('ko');
    el.bubble.textContent = '…';
    showBanner(COPY.ko, 0, 'ko');
    sfx('ko');
    el.inputArea.hidden = true;
    el.help.hidden = true;
    el.ko.hidden = false;
    el.koMsg.textContent = COPY.koMessage;
    setFeedback('');
    schedule(() => el.koMsg.focus({ preventScroll: true }), 50);
    if (!s.afterTouched) {
      s.after = s.strength;
      setRange(el.after, el.afterOut, s.after);
    }
  }

  // ---------- Sound (off by default, generated in code) ----------

  let audio = null;
  let soundOn = false;

  function tone(freq, start, dur, type = 'square', vol = 0.06, slideTo) {
    const t0 = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sfx(kind) {
    if (!soundOn || !audio) return;
    switch (kind) {
      case 'hit': tone(520, 0, 0.12, 'square', 0.05, 180); break;
      case 'weak': tone(240, 0, 0.1, 'triangle', 0.05, 200); break;
      case 'miss': tone(200, 0, 0.08, 'triangle', 0.04); tone(160, 0.1, 0.1, 'triangle', 0.04); break;
      case 'big': tone(330, 0, 0.1); tone(440, 0.08, 0.1); tone(660, 0.16, 0.25, 'square', 0.06, 220); break;
      case 'combo': [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.12, 'square', 0.04)); break;
      case 'round': tone(392, 0, 0.15, 'square', 0.04); break;
      case 'fight': tone(587, 0, 0.2, 'square', 0.05); break;
      case 'ko': [784, 659, 523, 392].forEach((f, i) => tone(f, i * 0.12, 0.18, 'triangle', 0.06)); break;
      case 'breathe': tone(330, 0, 0.6, 'sine', 0.05); break;
    }
  }

  el.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    if (soundOn && !audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audio = new Ctx();
    }
    if (audio && audio.state === 'suspended') audio.resume();
    el.sound.setAttribute('aria-pressed', String(soundOn));
    el.sound.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    if (soundOn) tone(660, 0, 0.08, 'square', 0.04);
  });

  // ---------- Debrief & result ----------

  function render() {
    s.finishedAt = s.finishedAt || new Date();
    $$('[data-fecho="thought"]').forEach((n) => { n.textContent = s.thought.trim(); });
    $('#f-card-date').textContent = api.formatDate(s.finishedAt);
    $('#f-belief-line').textContent = `${s.strength} → ${s.after}`;
    $('#f-num-before').textContent = String(s.strength);
    $('#f-num-after').textContent = String(s.after);
    $('#f-feeling-out').textContent = feelingLabel();
    $('#f-time-out').textContent = formatDuration(fightElapsed());
    $('#f-breaks-out').textContent = String(s.breaks);

    const out = $('#f-lines-out');
    out.textContent = '';
    groupedLines().forEach(({ title, lines }) => {
      const h = document.createElement('h3');
      h.textContent = title;
      const ul = document.createElement('ul');
      lines.forEach((l) => {
        const li = document.createElement('li');
        li.textContent = l.line;
        const d = document.createElement('span');
        d.className = 'line-dmg';
        d.textContent = ` −${l.damage}`;
        li.appendChild(d);
        ul.appendChild(li);
      });
      out.append(h, ul);
    });
    if (s.finisherUsed) {
      const p = document.createElement('p');
      p.className = 'finisher-note';
      p.textContent = `${COPY.finisherName} finisher landed (−${finisherDamage()}).`;
      out.appendChild(p);
    }

    const bb = $('#f-bar-before');
    const ba = $('#f-bar-after');
    bb.style.width = '0';
    ba.style.width = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bb.style.width = s.strength + '%';
      ba.style.width = s.after + '%';
    }));
  }

  function feelingLabel() {
    const f = FEELINGS.find((x) => x.value === s.feeling);
    return f ? `${f.label} (${f.value}/5)` : '—';
  }

  function groupedLines() {
    return MOVES
      .map((m) => ({ title: m.name, lines: s.log.filter((l) => l.move === m.id) }))
      .filter((g) => g.lines.length);
  }

  function buildMarkdown() {
    const out = [`# Flip · Fight — ${api.formatDate(s.finishedAt || new Date())}`, ''];
    out.push('## The thought', '', s.thought.trim(), '');
    out.push('## Strength', '', `**${s.strength} → ${s.after}**`, '', '```',
      `Before ${api.textBar(s.strength)} ${s.strength}`,
      `After  ${api.textBar(s.after)} ${s.after}`, '```', '');
    out.push('## How I feel', '', feelingLabel(), '');
    out.push('## The fight', '',
      `- Fight time: ${formatDuration(fightElapsed())}`,
      `- Breathing breaks: ${s.breaks}`,
      `- ${COPY.finisherName}: ${s.finisherUsed ? 'landed' : 'not used'}`, '');
    out.push('## Your counter-arguments', '');
    groupedLines().forEach(({ title, lines }) => {
      out.push(`### ${title}`, '');
      lines.forEach((l) => out.push(`- ${l.line} _(−${l.damage})_`));
      out.push('');
    });
    out.push('---', '', `_${COPY.koMessage}_`, '',
      "_Made with Flip. This is a self-help exercise, not therapy. If you're in crisis: India — Tele-MANAS 14416 · Elsewhere — findahelpline.com_", '');
    return out.join('\n');
  }

  function buildText() {
    const date = api.formatDate(s.finishedAt || new Date());
    const rule = (t, ch) => ch.repeat(Math.max(t.length, 4));
    const out = ['FLIP · FIGHT', date, rule(date, '='), ''];
    const sec = (h) => out.push(h, rule(h, '-'));
    sec('THE THOUGHT'); out.push(s.thought.trim(), '');
    sec('STRENGTH');
    out.push(`${s.strength} -> ${s.after}`,
      `Before ${api.textBar(s.strength)} ${s.strength}`,
      `After  ${api.textBar(s.after)} ${s.after}`, '');
    sec('HOW I FEEL'); out.push(feelingLabel(), '');
    sec('THE FIGHT');
    out.push(`Fight time: ${formatDuration(fightElapsed())}`, `Breathing breaks: ${s.breaks}`,
      `${COPY.finisherName}: ${s.finisherUsed ? 'landed' : 'not used'}`, '');
    sec('YOUR COUNTER-ARGUMENTS');
    groupedLines().forEach(({ title, lines }) => {
      out.push(`${title}:`);
      lines.forEach((l) => out.push(`  * ${l.line} (-${l.damage})`));
      out.push('');
    });
    out.push('--', COPY.koMessage,
      "This is a self-help exercise, not therapy. If you're in crisis: India - Tele-MANAS 14416 / Elsewhere - findahelpline.com", '');
    return out.join('\n');
  }

  function download(kind) {
    const name = `flip-fight-${api.fileStamp(s.finishedAt || new Date())}.${kind}`;
    if (kind === 'md') api.downloadFile(name, buildMarkdown(), 'text/markdown');
    else api.downloadFile(name, buildText(), 'text/plain');
    s.downloaded = true;
    api.refreshDirty();
    $('#hint-f6').textContent = `Downloaded ${name}. It's only on your device.`;
  }

  function reset() {
    clearAllTimers();
    const soundWas = soundOn;
    s = fresh();
    soundOn = soundWas;
    el.thought.value = '';
    setRange(el.strength, el.strengthOut, 50);
    setRange(el.after, el.afterOut, 50);
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });
    $('#hint-f6').textContent = '';
    document.body.classList.remove('arena-mode');
    thoughtGate();
  }

  function fightAgain() {
    clearAllTimers();
    s.strength = s.after;
    s.finishedAt = null;
    setRange(el.strength, el.strengthOut, s.strength);
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });
    $('#hint-f6').textContent = '';
    updatePreview();
    show('f2');
  }

  // ---------- Mobile keyboard: keep arena + controls inside the visible viewport ----------

  function syncViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
    if (document.body.classList.contains('arena-mode')) window.scrollTo(0, 0);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', syncViewport);

  // ---------- Wiring ----------

  el.thought.addEventListener('input', () => {
    s.thought = el.thought.value;
    touch();
    thoughtGate();
  });
  el.strength.addEventListener('input', () => {
    s.strength = Number(el.strength.value);
    setRange(el.strength, el.strengthOut, s.strength);
    updatePreview();
  });
  el.after.addEventListener('input', () => {
    s.afterTouched = true;
    s.after = Number(el.after.value);
    s.finishedAt = null;
    setRange(el.after, el.afterOut, s.after);
  });
  el.feelings.addEventListener('change', (e) => {
    if (e.target.name !== 'f-feeling') return;
    s.feeling = Number(e.target.value);
    s.finishedAt = null;
    feelingGate();
  });
  el.moves.addEventListener('change', (e) => {
    if (e.target.name !== 'f-move') return;
    activity();
    selectMove(e.target.value);
  });
  el.line.addEventListener('input', activity);
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    attack();
  });
  el.finisher.addEventListener('click', useFinisher);
  el.helpBtn.addEventListener('click', () => {
    const open = el.help.hidden;
    el.help.hidden = !open;
    el.helpBtn.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'fight-start': start(); break;
      case 'f-next':
        if (!thoughtGate()) { nudge('#hint-f1', el.thought); break; }
        updatePreview();
        show('f2');
        break;
      case 'f-fight': enterArena(); break;
      case 'f-leave': api.askReset(); break;
      case 'f-debrief':
        el.banner.className = 'banner';
        show('f4');
        break;
      case 'f-to-feel': show('f5'); feelingGate(); break;
      case 'f-result':
        if (!feelingGate()) { nudge('#hint-f5'); break; }
        render();
        show('f6');
        break;
      case 'f-dl-md': download('md'); break;
      case 'f-dl-txt': download('txt'); break;
      case 'f-again': fightAgain(); break;
    }
  });

  setRange(el.strength, el.strengthOut, 50);
  setRange(el.after, el.afterOut, 50);
  thoughtGate();
  syncViewport();

  return { start, back, reset, isDirty };
}
