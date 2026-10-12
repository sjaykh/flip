// Fight mode UI: screens, the game loop, input, overlays, sound and the debrief.
// Rules and pacing live in logic.js (pure; driven here by tick()), art in render.js,
// words and numbers in constants.js. All user text goes in with textContent only.
import {
  TUNING, PACING, MOVES, EMOTIONS, FEELINGS, COPY, OPPONENT_NAME, GRIP_LABEL, EMOTION_METER_LABEL,
} from './constants.js';
import {
  createRng, sanitizeText, slotValue, buildContext, setupGate, createCommentState, nextComment,
  maybeQueueComeback, travelTime, createFight, applyEvidence, startFighting, focusKey, tick,
  launchComment, applyAttack, applyBlock, applyCommentHit, applyBalancedThought, setBalancedBelief,
  recover, endRound, emotionMeter, strongestLine, topBlockedTraps, bestAction, startingGrip,
  opponentSize, initialMoves, rotateMoves, resultSections, copingCard, buildResultMarkdown,
  buildResultText,
} from './logic.js';
import { createRenderer, drawOpponentPreview, ARENA_W, PLAYER_X, OPPONENT_X } from './render.js';

export function initFight(api) {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Test-only hooks (set by scripts/check.mjs through Playwright). Real users never have them.
  const testHooks = () => window.__flipTest || {};
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedMQ.matches;
  const FOOTER = "Made with Flip. This is a self-help exercise, not therapy. If you're in crisis: India — Tele-MANAS 14416 · Elsewhere — findahelpline.com";

  const el = {
    situation: $('#f-situation'),
    emotions: $('#f-emotions'),
    otherWrap: $('#f-other-wrap'),
    other: $('#f-other'),
    intensity: $('#f-intensity'),
    intensityOut: $('#f-intensity-out'),
    thought: $('#f-thought'),
    fear: $('#f-fear'),
    who: $('#f-who'),
    belief: $('#f-belief'),
    beliefOut: $('#f-belief-out'),
    preview: $('#f-preview'),
    previewHp: $('#f-preview-hp'),
    previewQuote: $('#f-preview-quote'),
    safety: $('#f-safety-banner'),
    wrap: $('#f-arena-wrap'),
    screen: $('#f-screen'),
    canvas: $('#f-canvas'),
    quote: $('#f-quote'),
    proj: $('#f-projectile'),
    projTrap: $('#f-proj-trap'),
    projText: $('#f-proj-text'),
    breathe: $('#f-breathe'),
    breatheMsg: $('#f-breathe-msg'),
    breathePhase: $('#f-breathe-phase'),
    breatheCount: $('#f-breathe-count'),
    between: $('#f-between'),
    betweenTitle: $('#f-between-title'),
    betweenText: $('#f-between-text'),
    betweenBox: $('#f-between-box'),
    pause: $('#f-pause'),
    pauseTitle: $('#f-pause-title'),
    status: $('#f-status'),
    announce: $('#f-announce'),
    feedback: $('#f-feedback'),
    helpBtn: $('#f-help-btn'),
    help: $('#f-help'),
    round0: $('#f-round0'),
    evidence: $('#f-evidence'),
    evidenceBtn: $('#f-evidence-btn'),
    inputArea: $('#f-input-area'),
    moves: $('#f-moves'),
    finisher: $('#f-finisher'),
    form: $('#f-form'),
    line: $('#f-line'),
    lineLabel: $('#f-line-label'),
    hitBtn: $('#f-hit-btn'),
    balanced: $('#f-balanced'),
    balancedLead: $('#f-balanced-lead'),
    material: $('#f-material'),
    balancedForm: $('#f-balanced-form'),
    balancedText: $('#f-balanced-text'),
    balancedBack: $('#f-balanced-back'),
    balancedRate: $('#f-balanced-rate'),
    balancedBelief: $('#f-balanced-belief'),
    balancedBeliefOut: $('#f-balanced-belief-out'),
    balancedDone: $('#f-balanced-done'),
    end: $('#f-end'),
    endMsg: $('#f-end-msg'),
    beliefAfter: $('#f-belief-after'),
    beliefAfterOut: $('#f-belief-after-out'),
    intensityAfter: $('#f-intensity-after'),
    intensityAfterOut: $('#f-intensity-after-out'),
    feelings: $('#f-feelings'),
  };

  // ---------- State ----------

  const settings = { breathing: true, calm: false, sound: false };
  const freshSetup = () => ({
    screen: null,
    situation: '',
    emotions: [],
    otherEmotion: '',
    intensity: 60,
    thought: '',
    fear: '',
    who: '',
    belief: 50,
    beliefAfter: 50,
    intensityAfter: 60,
    feeling: null,
    downloaded: false,
    finishedAt: null,
  });
  let setup = freshSetup();
  let ctx = null;
  let fight = null;
  let gen = null;
  let rng = null;
  let sim = null;
  let renderer = null;
  let rafId = 0;
  let lastTs = 0;

  const freshSim = () => ({
    now: 0, // visual clock (ms), stops while paused
    paused: false,
    finishing: false, // writing the balanced thought: the fight holds still
    events: [],
    banner: null,
    floaters: [],
    particles: [],
    shakeUntil: 0,
    playerPose: 'idle',
    playerPoseUntil: 0,
    opponentPose: 'idle',
    opponentPoseUntil: 0,
    playerFlashUntil: 0,
    opponentFlashUntil: 0,
    opponentShown: 0.5,
    playerGhost: TUNING.playerHp,
    gripGhost: 100,
    fightMs: 0,
    koLit: false,
    move: MOVES[0].id,
    layout: initialMoves(true),
    mode: 'off',
    opening: null, // Round 0 bubble tween
    balancedMode: null, // 'ko' | 'timeout'
    balancedDraft: '',
    statusKey: '',
    wasFocus: false,
  });

  // ---------- Static UI built from constants ----------

  $$('[data-rules]').forEach((ul) => {
    COPY.rules.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      ul.appendChild(li);
    });
  });

  EMOTIONS.forEach((e) => {
    const label = document.createElement('label');
    label.className = 'chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'f-emotion';
    input.value = e.id;
    const text = document.createElement('span');
    text.textContent = e.label;
    label.append(input, text);
    el.emotions.appendChild(label);
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

  const SETTING_DEFS = [
    { key: 'breathing', label: 'Breathing breaks', desc: 'Box breathing when you get knocked down. Skippable any time.' },
    { key: 'calm', label: 'Calm pace', desc: 'Slower comments, longer gaps, mostly generic lines. Comments freeze while you type.' },
    { key: 'sound', label: 'Sound', desc: 'Simple blips made in code.' },
  ];
  $$('[data-switches]').forEach((box) => {
    SETTING_DEFS.forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'switch';
      btn.setAttribute('role', 'switch');
      btn.dataset.setting = d.key;
      const text = document.createElement('span');
      text.className = 'switch-text';
      const lab = document.createElement('span');
      lab.className = 'switch-label';
      lab.textContent = d.label;
      const desc = document.createElement('span');
      desc.className = 'switch-desc';
      desc.textContent = d.desc;
      text.append(lab, desc);
      const state = document.createElement('span');
      state.className = 'switch-state';
      state.setAttribute('aria-hidden', 'true');
      const track = document.createElement('span');
      track.className = 'switch-track';
      track.setAttribute('aria-hidden', 'true');
      btn.append(text, state, track);
      box.appendChild(btn);
    });
  });

  function syncSwitches() {
    $$('.switch').forEach((b) => {
      const on = settings[b.dataset.setting];
      b.setAttribute('aria-checked', String(on));
      b.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
    });
  }

  $('#f-evidence-label').textContent = COPY.evidenceLabel;
  el.evidenceBtn.textContent = COPY.evidenceButton;
  $('#f-balanced-label').textContent = COPY.finisherPrompt;
  $('#f-balanced-belief-label').textContent = COPY.balancedBelief;
  $('#f-preview-name').textContent = OPPONENT_NAME;

  // ---------- Helpers ----------

  function setRange(input, out, v) {
    input.value = String(v);
    out.textContent = String(v);
    input.setAttribute('aria-valuetext', `${v} out of 100`);
    input.style.setProperty('--fill', v + '%');
  }

  function touch() {
    setup.downloaded = false;
    setup.finishedAt = null;
  }

  function isDirty() {
    return setup.thought.trim().length > 0 && !setup.downloaded;
  }

  function setHint(sel, text, ready = false) {
    const h = $(sel);
    if (!h) return;
    if (h.textContent !== text) h.textContent = text;
    h.classList.toggle('ready', ready);
  }

  function nudge(sel, focusEl) {
    const h = $(sel);
    if (h) {
      h.classList.remove('nudge');
      void h.offsetWidth;
      h.classList.add('nudge');
    }
    if (focusEl) focusEl.focus();
  }

  function say(text) {
    el.announce.textContent = '';
    window.setTimeout(() => { el.announce.textContent = text; }, 30);
  }

  function feedback(text, tone = '') {
    el.feedback.textContent = text;
    el.feedback.className = `f-feedback ${tone}`.trim();
  }

  function setGate(name, ok) {
    $$(`[data-fgate="${name}"]`).forEach((b) => b.setAttribute('aria-disabled', String(!ok)));
    return ok;
  }

  function emotionNames() {
    return setup.emotions.map((id) => (id === 'other' ? (slotValue(setup.otherEmotion, TUNING.otherEmotionMaxChars) || 'other') : id));
  }

  function contextInput() {
    return { situation: setup.situation, who: setup.who, fear: setup.fear, otherEmotion: setup.otherEmotion };
  }

  // ---------- Setup screens ----------

  function feelingsGate() {
    const ok = setupGate('feelings', setup);
    let hint = '';
    if (!setup.emotions.length) hint = COPY.feelingsHint.none;
    else if (!ok) hint = COPY.feelingsHint.other;
    setHint('#hint-f2', hint);
    el.otherWrap.hidden = !setup.emotions.includes('other');
    return setGate('feelings', ok);
  }

  function thoughtGate() {
    const n = sanitizeText(setup.thought, TUNING.thoughtMaxChars).length;
    const ok = setupGate('thought', setup);
    const hint = n === 0 ? COPY.thoughtHints.empty : ok ? COPY.thoughtHints.ok : COPY.thoughtHints.short;
    setHint('#hint-f3', hint, ok);
    return setGate('thought', ok);
  }

  function updatePreview() {
    const grip = startingGrip(setup.belief);
    el.previewHp.textContent = String(grip);
    drawOpponentPreview(el.preview, opponentSize(grip));
    const c = buildContext(contextInput(), setup.thought);
    el.previewQuote.textContent = c.safeMode ? '' : `“${c.thought}”`;
    let hint = '';
    if (c.safeMode) hint = COPY.safetyBanner;
    else if (c.situationSource === 'extracted') hint = `Situation: “${c.situation}” (taken from your thought).`;
    setHint('#hint-f6', hint);
  }

  const BACK_FROM = { f1: 'home', f2: 'f1', f3: 'f2', f4: 'f3', f5: 'f4', f6: 'f5', f7: 'f6', f10: 'f9', f11: 'f10', f12: 'f11' };
  const GATES = { f2: feelingsGate, f3: thoughtGate };

  function show(id) {
    setup.screen = id;
    const inArena = id === 'f8';
    document.body.classList.toggle('arena-mode', inArena);
    api.showScreen(id, { back: Boolean(BACK_FROM[id]) });
    if (GATES[id]) GATES[id]();
    if (id === 'f6') updatePreview();
    if (inArena) { syncViewport(); fitScreen(); } else stopLoop();
  }

  function start() {
    api.setMode('fight');
    show('f1');
  }

  function back() {
    const to = BACK_FROM[setup.screen];
    if (to === 'home') api.home();
    else if (to) show(to);
  }

  // ---------- Visual-clock scheduling (pausable) ----------

  function at(delay, fn, tag = '') {
    sim.events.push({ t: sim.now + delay, fn, tag });
  }
  function cancel(tag) {
    sim.events = sim.events.filter((e) => e.tag !== tag);
  }
  function runEvents() {
    for (let guard = 0; guard < 50; guard++) {
      const due = sim.events.filter((e) => e.t <= sim.now).sort((a, b) => a.t - b.t);
      if (!due.length) return;
      sim.events = sim.events.filter((e) => !due.includes(e));
      for (const e of due) {
        e.fn();
        if (!sim) return;
      }
    }
  }

  // ---------- Effects ----------

  function banner(text, ms, opts = {}) {
    sim.banner = { text, at: sim.now, until: ms ? sim.now + ms : Infinity, ...opts };
  }

  function floater(text, x, y, color, scale = 2) {
    sim.floaters.push({ text, x, y, at: sim.now, life: 1000, color, scale, static: reduced() });
  }

  function burst(x, y, colors, n = 14) {
    if (reduced()) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 40 + (i % 4) * 18;
      sim.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, at: sim.now, life: 0.6, color: colors[i % colors.length], size: 1 + (i % 2) });
    }
  }

  function shake(ms = 250) {
    if (!reduced()) sim.shakeUntil = sim.now + ms;
  }

  function playerPose(pose, ms) {
    sim.playerPose = pose;
    sim.playerPoseUntil = ms === Infinity ? Infinity : sim.now + ms;
  }

  function opponentPose(pose, ms) {
    sim.opponentPose = pose;
    sim.opponentPoseUntil = sim.now + ms;
  }

  function opponentTakes(dmg, kind) {
    if (dmg <= 0) return;
    floater(`-${dmg}`, OPPONENT_X, 56, kind === 'weak' ? ['#d8cfe6', '#a99fc0'] : ['#e9e1ff', '#c9b8ff'], kind === 'big' ? 3 : 2);
    opponentPose('hit', 260);
    if (!reduced()) sim.opponentFlashUntil = sim.now + 90;
    if (dmg >= 8) shake(kind === 'big' ? 420 : 250);
    burst(OPPONENT_X - 14, 76, ['#fff3b0', '#ffb347', '#c9b8ff'], kind === 'big' ? 22 : 10);
    sfx(kind === 'weak' ? 'weak' : 'hit');
  }

  function playerTakes(dmg) {
    floater(`-${dmg}`, PLAYER_X, 50, ['#ffb3a7', '#e8483f']);
    playerPose('hit', 360);
    if (!reduced()) sim.playerFlashUntil = sim.now + 80;
    shake(220);
    sfx('hurt');
  }

  // ---------- Moves ----------

  function moveDef(id = sim.move) {
    return MOVES.find((m) => m.id === id);
  }

  function renderMoves() {
    el.moves.querySelectorAll('.move').forEach((n) => n.remove());
    sim.layout.visible.forEach((id) => {
      const m = moveDef(id);
      const label = document.createElement('label');
      label.className = 'move';
      label.dataset.move = id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'f-move';
      input.value = id;
      input.checked = id === sim.move;
      const name = document.createElement('span');
      name.className = 'move-name';
      name.textContent = m.name;
      const tick = document.createElement('span');
      tick.className = 'move-tick';
      tick.setAttribute('aria-hidden', 'true');
      label.append(input, name, tick);
      label.classList.toggle('selected', id === sim.move);
      label.classList.toggle('landed', fight.movesUsed.includes(id));
      el.moves.appendChild(label);
    });
    el.moves.classList.toggle('six', sim.layout.visible.length > 4);
    setMode(sim.mode);
  }

  function selectMove(id) {
    sim.move = id;
    $$('.move').forEach((l) => l.classList.toggle('selected', l.dataset.move === id));
    setMode(sim.mode);
  }

  function afterMoveUsed(id) {
    const i = sim.layout.visible.indexOf(id);
    const next = rotateMoves(sim.layout, id);
    if (next !== sim.layout) {
      sim.layout = next;
      sim.move = next.visible[i];
    }
    renderMoves();
  }

  // ---------- Input modes ----------

  function setMode(mode) {
    sim.mode = mode;
    el.form.dataset.mode = mode;
    const off = mode === 'off' || sim.paused || sim.finishing;
    el.line.disabled = off;
    el.hitBtn.disabled = off;
    el.finisher.disabled = off;
    $$('input[name="f-move"]').forEach((i) => { i.disabled = off; });
    if (mode === 'block' && fight.projectile) {
      el.lineLabel.textContent = COPY.blockPrompt(fight.projectile.comment.trap);
      el.line.placeholder = 'Answer it, then press Enter';
      el.hitBtn.textContent = 'Block';
    } else {
      const m = moveDef();
      el.lineLabel.textContent = `${m.name}: ${m.prompt}`;
      el.line.placeholder = m.prompt;
      el.hitBtn.textContent = 'Hit';
    }
  }

  function pulsePrompt() {
    el.lineLabel.classList.remove('pulse');
    void el.lineLabel.offsetWidth;
    el.lineLabel.classList.add('pulse');
  }

  // ---------- Focus mode ----------

  function keyActivity() {
    if (!fight || fight.phase !== 'fight' || sim.paused || sim.finishing) return;
    const r = focusKey(fight);
    fight = r.fight;
    if (r.entered) {
      say(COPY.focusOn);
      sfx('focusOn');
    }
  }

  // ---------- Comments ----------

  function projX(p) {
    return 0.66 - 0.36 * p;
  }

  function showProjectile(comment) {
    el.projTrap.textContent = comment.trap;
    el.projText.textContent = comment.text;
    el.proj.className = 'projectile';
    el.proj.dataset.trap = comment.trapId;
    el.proj.hidden = false;
    positionProjectile(0);
  }

  function positionProjectile(p) {
    el.proj.style.left = `${(projX(p) * 100).toFixed(2)}%`;
    el.proj.dataset.progress = p.toFixed(3);
  }

  function hideProjectile(how, p = 0.5) {
    el.proj.className = `projectile ${how}`;
    if (how === 'shatter') burst(projX(p) * ARENA_W, 66, ['#ffe08a', '#c9b8ff', '#ffffff'], 24);
    window.setTimeout(() => {
      if (!fight || !fight.projectile) { el.proj.hidden = true; el.proj.className = 'projectile'; }
    }, reduced() ? 120 : 360);
  }

  function throwComment() {
    const r = nextComment(gen, ctx, rng, { calm: settings.calm });
    gen = r.gen;
    const travel = travelTime({ width: window.innerWidth, calm: settings.calm, reducedMotion: reduced() });
    fight = launchComment(fight, r.comment, travel);
    showProjectile(r.comment);
    opponentPose('throw', 420);
    sfx('throw');
    feedback('');
    setMode('block');
    say(COPY.incoming(r.comment.trap, r.comment.text));
  }

  function commentLands() {
    const p = fight.projectile ? fight.projectile.progress : 1;
    const r = applyCommentHit(fight, rng, { calm: settings.calm });
    fight = r.fight;
    hideProjectile('impact', p);
    playerTakes(r.damage);
    feedback(COPY.hitTaken(r.damage), 'soft');
    say(COPY.hitTaken(r.damage));
    setMode('attack');
    if (fight.down) knockdown();
  }

  // ---------- Round 0 ----------

  function evidenceGate() {
    const ok = setupGate('evidence', { evidence: el.evidence.value });
    setHint('#hint-evidence', el.evidence.value.trim() && !ok ? COPY.evidenceShort : COPY.evidenceHint);
    return setGate('evidence', ok);
  }

  function submitEvidence() {
    if (!fight || fight.phase !== 'round0' || sim.opening || sim.paused) return;
    if (!evidenceGate()) { nudge('#hint-evidence', el.evidence); return; }
    const text = sanitizeText(el.evidence.value);
    ctx = buildContext({ ...contextInput(), evidence: text }, setup.thought);
    applySafetyUi();
    el.round0.hidden = true;
    sim.banner = null;
    const bubble = { text: ctx.safeMode ? COPY.evidenceSafeBubble : text, trap: COPY.evidenceTrap, trapId: 'evidence' };
    showProjectile(bubble);
    opponentPose('throw', 420);
    sfx('throw');
    say(COPY.incoming(bubble.trap, bubble.text));
    sim.opening = { text, start: sim.now };
    touch();
  }

  function openingArrives() {
    const { text } = sim.opening;
    sim.opening = null;
    fight = applyEvidence(fight, text).fight;
    hideProjectile('impact', 1);
    playerTakes(TUNING.openingHitDamage);
    feedback(COPY.evidenceLanded, 'good');
    say(COPY.evidenceLanded);
    at(1200, () => startRound(), 'intro');
  }

  // ---------- Player actions ----------

  function submit() {
    if (!sim || fight.phase !== 'fight' || sim.paused || sim.finishing) return;
    const text = sanitizeText(el.line.value, TUNING.lineMaxChars);
    if (!text) { feedback(COPY.empty); el.line.focus(); return; }
    el.line.value = '';
    touch();
    const used = sim.move;
    if (fight.projectile) doBlock(text);
    else doAttack(text);
    if (fight && !fight.ended) afterMoveUsed(used);
  }

  function noteUnlock(justUnlocked) {
    if (justUnlocked) {
      banner(COPY.finisher, 1000, { scale: 3 });
      feedback(COPY.finisherReady, 'good');
      say(COPY.finisherReady);
      sfx('combo');
    }
    el.finisher.hidden = !fight.finisherReady || Boolean(fight.ended);
  }

  function hitText(m, res, actual) {
    const extras = [...res.reasons];
    if (res.variety) extras.push(`first ${m.name} +${res.variety}`);
    const extra = extras.length ? ` · ${extras.join(', ')}` : '';
    return COPY.hit(m.name, actual, extra);
  }

  function doAttack(text) {
    const m = moveDef();
    const gripBefore = fight.grip;
    const r = applyAttack(fight, m.id, text);
    fight = r.fight;
    const res = r.result;
    if (res.verdict === 'repeat') {
      feedback(COPY.repeat, 'soft');
      floater('0', OPPONENT_X, 56, ['#d8cfe6', '#a99fc0']);
      sfx('weak');
      return;
    }
    const actual = gripBefore - fight.grip;
    playerPose(m.anim, 300);
    opponentTakes(actual, res.verdict === 'vague' ? 'weak' : 'hit');
    if (res.verdict === 'vague') feedback(`${COPY.vague} (${actual})`, 'soft');
    else {
      feedback(hitText(m, res, actual), 'good');
      gen = maybeQueueComeback(gen, text, ctx, rng);
    }
    if (fight.grip <= TUNING.gripFloor && actual < res.damage) feedback(COPY.floorReached, 'good');
    noteUnlock(r.justUnlocked);
  }

  function doBlock(text) {
    const m = moveDef();
    const comment = fight.projectile.comment;
    const p = fight.projectile.progress;
    const r = applyBlock(fight, m.id, text, rng, { calm: settings.calm });
    fight = r.fight;
    const { outcome, result } = r;
    if (outcome.kind === 'parry') {
      hideProjectile('shatter', p);
      playerPose(m.anim, 300);
      opponentTakes(outcome.gripDamage, 'hit');
      banner(COPY.parry, 700, { scale: 4 });
      feedback(COPY.parried(outcome.gripDamage), 'good');
      say(`Parry! ${comment.trap} blocked. Grip down ${outcome.gripDamage}.`);
      sfx('parry');
      gen = maybeQueueComeback(gen, text, ctx, rng);
      noteUnlock(r.justUnlocked);
    } else if (outcome.kind === 'partial') {
      hideProjectile('absorb', p);
      playerPose('block', 400);
      floater(`-${outcome.playerDamage}`, PLAYER_X, 50, ['#ffd6a0', '#e89a4f']);
      sfx('block');
      feedback(COPY.partial(outcome.playerDamage), 'soft');
      say(COPY.partial(outcome.playerDamage));
    } else {
      hideProjectile('impact', p);
      playerTakes(outcome.playerDamage);
      const why = result.verdict === 'repeat' ? `${COPY.repeat} ` : result.verdict === 'vague' ? `${COPY.vague} ` : '';
      feedback(`${why}${COPY.hitTaken(outcome.playerDamage)}`, 'soft');
      say(`${why}${COPY.hitTaken(outcome.playerDamage)}`);
    }
    setMode('attack');
    if (fight.down) knockdown();
  }

  // ---------- The balanced thought ----------

  function fillMaterial() {
    el.material.textContent = '';
    const rows = [];
    if (fight.evidence) rows.push([COPY.finisherEvidence, fight.evidence]);
    const best = strongestLine(fight);
    if (best) rows.push([COPY.finisherBest, best.line]);
    rows.forEach(([k, v]) => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      d.append(dt, dd);
      el.material.appendChild(d);
    });
    el.material.hidden = !rows.length;
  }

  function openBalanced(mode) {
    sim.balancedMode = mode;
    sim.finishing = true;
    feedback('');
    if (fight.projectile) {
      hideProjectile('fade', fight.projectile.progress);
      fight = { ...fight, projectile: null, throwTimer: Infinity, focus: { ...fight.focus, active: false } };
    }
    setMode('off');
    el.inputArea.hidden = true;
    el.end.hidden = true;
    el.help.hidden = true;
    el.balanced.hidden = false;
    el.balancedForm.hidden = false;
    el.balancedRate.hidden = true;
    el.balancedText.value = sim.balancedDraft;
    el.balancedLead.textContent = mode === 'ko' ? COPY.finisherMaterial : `${COPY.timeoutMessage(fight.gripStart, fight.grip)} ${COPY.timeoutBalanced}`;
    el.balancedBack.textContent = mode === 'ko' ? 'Not yet' : 'Skip';
    el.balancedDone.textContent = mode === 'ko' ? 'Finish' : 'Continue';
    setRange(el.balancedBelief, el.balancedBeliefOut, 50);
    fillMaterial();
    balancedGate();
    if (mode === 'ko') {
      banner(COPY.finisher, 1000, { scale: 3 });
      say(`${COPY.finisher}. ${COPY.finisherPrompt}`);
    }
    window.setTimeout(() => el.balancedText.focus({ preventScroll: true }), 50);
  }

  function closeBalanced() {
    el.balanced.hidden = true;
    sim.balancedDraft = el.balancedText.value;
    if (sim.balancedMode === 'ko') {
      sim.finishing = false;
      el.inputArea.hidden = false;
      fight = startFighting(fight, settings.calm);
      setMode('attack');
      el.line.focus({ preventScroll: true });
    } else {
      showEnd(COPY.timeoutMessage(fight.gripStart, fight.grip));
    }
    sim.balancedMode = null;
  }

  function balancedGate() {
    const n = sanitizeText(el.balancedText.value).length;
    const ok = n >= TUNING.balancedMinChars;
    setHint('#hint-balanced', n && !ok ? COPY.finisherShort : '');
    return setGate('balanced', ok);
  }

  function submitBalanced() {
    if (!balancedGate()) { nudge('#hint-balanced', el.balancedText); return; }
    touch();
    el.balancedForm.hidden = true;
    el.balancedRate.hidden = false;
    window.setTimeout(() => el.balancedBelief.focus({ preventScroll: true }), 50);
  }

  function balancedDone() {
    const r = applyBalancedThought(fight, el.balancedText.value);
    if (!r.ok) return;
    fight = setBalancedBelief(r.fight, Number(el.balancedBelief.value));
    el.balanced.hidden = true;
    sim.finishing = false;
    if (sim.balancedMode === 'ko') knockOut();
    else goDebrief();
    sim.balancedMode = null;
  }

  // ---------- Knockdown, breathing, recovery ----------

  function knockdown() {
    cancel('round');
    if (fight.projectile) hideProjectile('fade', fight.projectile.progress);
    fight = { ...fight, projectile: null, throwTimer: Infinity };
    setMode('off');
    playerPose('down', Infinity);
    banner(COPY.down, PACING.downBannerMs, { scale: 3 });
    say(`Knocked down. ${COPY.down}.`);
    sfx('down');
    if (settings.breathing) at(1100, startBreathing, 'down');
    else at(PACING.downBannerMs, () => doRecover('off'), 'down');
  }

  function startBreathing() {
    el.breathe.hidden = false;
    const phaseMs = PACING.breathPhaseMs;
    el.breathe.style.setProperty('--phase-ms', `${phaseMs / (Number(testHooks().timeScale) || 1)}ms`);
    el.breatheMsg.textContent = COPY.breatheMessage;
    el.breatheMsg.focus({ preventScroll: true });
    say(COPY.breatheMessage);
    const phases = COPY.breathPhases;
    const total = phases.length * PACING.breathCycles;
    const secs = Math.round(phaseMs / 1000);
    for (let i = 0; i < total; i++) {
      at(i * phaseMs, () => {
        const p = i % phases.length;
        el.breathe.dataset.phase = String(p);
        el.breathePhase.textContent = phases[p];
        el.breatheCount.textContent = String(secs);
      }, 'breath');
      for (let k = 1; k < secs; k++) at(i * phaseMs + k * 1000, () => { el.breatheCount.textContent = String(secs - k); }, 'breath');
      if (i % phases.length === phases.length - 1) {
        at((i + 1) * phaseMs - 1, () => { fight = { ...fight, breathCycles: fight.breathCycles + 1 }; }, 'breath');
      }
    }
    at(total * phaseMs, () => doRecover('breathe'), 'breath');
  }

  function doRecover(how) {
    cancel('breath');
    cancel('down');
    const hadFocus = !el.breathe.hidden;
    el.breathe.hidden = true;
    delete el.breathe.dataset.phase;
    fight = recover(fight, how);
    playerPose('getup', 650);
    sim.banner = null;
    feedback(COPY.recovered, 'good');
    say(COPY.recovered);
    el.finisher.hidden = !fight.finisherReady;
    at(650, () => {
      fight = startFighting(fight, settings.calm);
      setMode('attack');
      if (hadFocus) el.line.focus({ preventScroll: true });
    }, 'down');
  }

  // ---------- Rounds ----------

  function startRound() {
    el.inputArea.hidden = false;
    setMode('off');
    banner(COPY.roundBanner(fight.round), 1000, { scale: 4 });
    sfx('round');
    say(`Round ${fight.round}.`);
    at(1100, () => {
      banner(COPY.fight, 800, { scale: 5 });
      sfx('fight');
      fight = startFighting(fight, settings.calm);
      setMode('attack');
      feedback(COPY.attackHint);
    }, 'intro');
  }

  function roundOver() {
    const finishedRound = fight.round;
    if (fight.projectile) hideProjectile('fade', fight.projectile.progress);
    fight = endRound(fight);
    setMode('off');
    banner(COPY.timeUp, 1000, { scale: 5 });
    if (fight.ended === 'timeout') {
      at(1100, () => {
        sim.banner = null;
        openBalanced('timeout');
      }, 'round');
      return;
    }
    at(1000, () => {
      const best = strongestLine(fight);
      el.betweenTitle.textContent = `Round ${finishedRound} done`;
      el.betweenText.textContent = COPY.betweenRounds(fight.grip, best ? best.line : '');
      el.betweenBox.hidden = !settings.breathing;
      el.between.hidden = false;
      say(`Round ${finishedRound} done. ${el.betweenText.textContent}`);
    }, 'round');
    at(1000 + PACING.betweenRoundsMs, () => {
      el.between.hidden = true;
      startRound();
    }, 'round');
  }

  // ---------- Endings ----------

  function showEnd(msg) {
    el.inputArea.hidden = true;
    el.help.hidden = true;
    el.balanced.hidden = true;
    el.end.hidden = false;
    el.endMsg.textContent = msg;
    window.setTimeout(() => el.endMsg.focus({ preventScroll: true }), 60);
  }

  function knockOut() {
    sim.events = [];
    feedback('');
    el.finisher.hidden = true;
    if (fight.projectile) hideProjectile('fade', fight.projectile.progress);
    playerPose('uppercut', 500);
    opponentPose('hit', 500);
    shake(420);
    burst(OPPONENT_X - 14, 76, ['#fff3b0', '#ffb347', '#c9b8ff'], 26);
    banner(COPY.finisher, 900, { scale: 3 });
    sfx('combo');
    at(900, () => {
      sim.koLit = true;
      banner(COPY.ko, 0, { scale: 5 });
      sfx('ko');
    }, 'ko');
    say(`K.O. ${COPY.koMessage}`);
    showEnd(COPY.koMessage);
  }

  function goDebrief() {
    stopLoop();
    setup.beliefAfter = setup.belief;
    setup.intensityAfter = setup.intensity;
    setRange(el.beliefAfter, el.beliefAfterOut, setup.beliefAfter);
    setRange(el.intensityAfter, el.intensityAfterOut, setup.intensityAfter);
    $('#f-intensity-after-label').textContent = COPY.rerateEmotion(emotionNames().join(', '));
    $$('[data-fecho="thought"]').forEach((n) => { n.textContent = sanitizeText(setup.thought, TUNING.thoughtMaxChars); });
    show('f9');
  }

  // ---------- Pause ----------

  function canPause() {
    return sim && fight && !fight.ended && setup.screen === 'f8';
  }

  function pause() {
    if (!canPause() || sim.paused) return;
    sim.paused = true;
    setMode(sim.mode);
    el.pause.hidden = false;
    el.pauseTitle.focus({ preventScroll: true });
    say('Paused.');
  }

  function resume() {
    if (!sim || !sim.paused) return;
    sim.paused = false;
    el.pause.hidden = true;
    setMode(sim.mode);
    if (!el.line.disabled && !el.inputArea.hidden) el.line.focus({ preventScroll: true });
    say('Resumed.');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || setup.screen !== 'f8') return;
    if ($('#confirm')?.open) return;
    e.preventDefault();
    if (sim?.paused) resume();
    else pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ---------- Loop ----------

  function startLoop() {
    stopLoop();
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const realDt = Math.min(100, Math.max(0, ts - lastTs));
    lastTs = ts;
    if (sim && fight && !sim.paused) step(realDt * (Number(testHooks().timeScale) || 1));
    if (sim && fight) draw();
  }

  function handleEvents(events) {
    for (const e of events) {
      if (!fight || fight.phase !== 'fight') return;
      if (e === 'focusExit') {
        say(COPY.focusOff);
        sfx('focusOff');
        if (fight.projectile) pulsePrompt();
      } else if (e === 'windup') {
        opponentPose('windup', PACING.windupMs);
        floater('!', OPPONENT_X + 8, 40, ['#fff3b0', '#ffb347'], 2);
        feedback(COPY.windup);
      } else if (e === 'throw') {
        throwComment();
      } else if (e === 'land') {
        commentLands();
      } else if (e === 'roundOver') {
        roundOver();
        return;
      }
    }
  }

  function step(dt) {
    sim.now += dt;
    if (!fight.ended) sim.fightMs += dt;

    if (sim.opening) {
      const p = Math.min(1, (sim.now - sim.opening.start) / PACING.openingTravelMs);
      positionProjectile(p);
      if (p >= 1) openingArrives();
    }

    if (fight.phase === 'fight' && !sim.finishing) {
      const r = tick(fight, dt, { calm: settings.calm });
      fight = r.fight;
      if (fight.projectile) positionProjectile(fight.projectile.progress);
      handleEvents(r.events);
    }
    runEvents();
    if (!sim) return;

    const focusOn = Boolean(fight.focus.active && fight.phase === 'fight');
    if (focusOn !== sim.wasFocus) {
      sim.wasFocus = focusOn;
      el.screen.classList.toggle('focus', focusOn);
    }

    const ease = (ghost, real) => (ghost <= real ? real : Math.max(real, ghost - dt * 0.03));
    sim.playerGhost = ease(sim.playerGhost, fight.playerHp);
    sim.gripGhost = ease(sim.gripGhost, fight.grip);
    const target = fight.ended === 'ko' ? 0.02 : opponentSize(fight.grip);
    sim.opponentShown += (target - sim.opponentShown) * Math.min(1, dt / (fight.ended === 'ko' ? 500 : 250));
    sim.floaters = sim.floaters.filter((f) => sim.now - f.at < f.life);
    sim.particles = sim.particles.filter((p) => sim.now - p.at < p.life * 1000);
    updateStatus();
  }

  function draw() {
    const now = sim.now;
    renderer.draw({
      t: now,
      reduced: reduced(),
      shakeUntil: sim.shakeUntil,
      particles: sim.particles,
      floaters: sim.floaters,
      playerPose: now < sim.playerPoseUntil ? sim.playerPose : (fight.down ? 'down' : 'idle'),
      opponentPose: now < sim.opponentPoseUntil ? sim.opponentPose : 'idle',
      opponentScale: sim.opponentShown,
      playerFlash: now < sim.playerFlashUntil,
      opponentFlash: now < sim.opponentFlashUntil,
      banner: sim.banner && now < sim.banner.until ? sim.banner : null,
      dim: sim.paused || !el.breathe.hidden || !el.between.hidden,
      hud: {
        streak: fight.streak,
        playerHp: fight.playerHp,
        playerMax: TUNING.playerHp,
        playerGhost: sim.playerGhost,
        gripHp: fight.grip,
        gripMax: fight.gripMax,
        gripGhost: sim.gripGhost,
        meter: emotionMeter(fight),
        meterLabel: EMOTION_METER_LABEL,
        gripLabel: GRIP_LABEL,
        focus: fight.focus.active && fight.phase === 'fight',
        focusLabel: COPY.focus,
        koLit: sim.koLit,
        playerName: COPY.playerName,
        opponentName: OPPONENT_NAME,
        timer: fight.roundTimeLeftMs / 1000,
        rounds: TUNING.rounds,
        round: Math.max(fight.round, 0),
      },
    });
  }

  function updateStatus() {
    const secs = Math.ceil(fight.roundTimeLeftMs / 5000) * 5;
    const key = `${fight.playerHp}|${fight.grip}|${fight.round}|${secs}|${fight.streak}|${fight.focus.active}`;
    if (key === sim.statusKey) return;
    sim.statusKey = key;
    el.status.textContent = `You ${fight.playerHp} of ${TUNING.playerHp} HP. ${OPPONENT_NAME} grip ${fight.grip} of ${fight.gripMax}. ${EMOTION_METER_LABEL} ${emotionMeter(fight)}. Round ${fight.round} of ${TUNING.rounds}, about ${secs} seconds left.${fight.focus.active ? ' Focus mode.' : ''}`;
    el.status.dataset.player = String(fight.playerHp);
    el.status.dataset.grip = String(fight.grip);
    el.status.dataset.focus = String(fight.focus.active);
    el.status.dataset.time = String(Math.round(fight.roundTimeLeftMs));
  }

  // ---------- Entering the arena ----------

  function applySafetyUi() {
    el.safety.hidden = !ctx.safeMode;
    el.safety.textContent = ctx.safeMode ? COPY.safetyBanner : '';
    el.quote.textContent = ctx.safeMode ? '' : `“${ctx.thought}”`;
  }

  function enterArena() {
    ctx = buildContext(contextInput(), setup.thought);
    const seed = Number(testHooks().seed) || ((Date.now() ^ (performance.now() * 1000)) >>> 0);
    rng = createRng(seed);
    gen = createCommentState();
    fight = createFight({ belief: setup.belief, intensity: setup.intensity });
    sim = freshSim();
    sim.layout = initialMoves(window.innerWidth >= PACING.desktopMinWidth);
    sim.move = sim.layout.visible[0];
    sim.opponentShown = opponentSize(fight.grip);
    sim.gripGhost = fight.grip;
    setup.feeling = null;
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });

    applySafetyUi();
    el.proj.hidden = true;
    el.breathe.hidden = true;
    el.between.hidden = true;
    el.pause.hidden = true;
    el.end.hidden = true;
    el.balanced.hidden = true;
    el.inputArea.hidden = true;
    el.finisher.hidden = true;
    el.help.hidden = true;
    el.helpBtn.setAttribute('aria-expanded', 'false');
    el.screen.classList.remove('focus');
    el.line.value = '';
    el.evidence.value = '';
    el.balancedText.value = '';
    el.round0.hidden = false;
    renderMoves();
    setMode('off');
    evidenceGate();
    feedback('');

    if (!renderer) renderer = createRenderer(el.canvas);
    show('f8');
    updateStatus();
    startLoop();
    banner(COPY.round0Banner, 0, { scale: 3 });
    sfx('round');
    say(`Round 0. Let it make its case. ${COPY.evidenceLabel}`);
    window.setTimeout(() => el.evidence.focus({ preventScroll: true }), 80);
  }

  // ---------- Sound (off by default, generated in code) ----------

  let audio = null;

  function ensureAudio() {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audio = new Ctx();
    }
    if (audio && audio.state === 'suspended') audio.resume();
  }

  function tone(freq, start, dur, type = 'square', vol = 0.05, slideTo) {
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
    if (!settings.sound || !audio) return;
    switch (kind) {
      case 'hit': tone(520, 0, 0.12, 'square', 0.05, 180); break;
      case 'weak': tone(240, 0, 0.1, 'triangle', 0.05, 200); break;
      case 'parry': tone(880, 0, 0.06, 'square', 0.05); tone(1320, 0.06, 0.12, 'square', 0.05); break;
      case 'block': tone(300, 0, 0.08, 'square', 0.04); break;
      case 'hurt': tone(180, 0, 0.18, 'sawtooth', 0.04, 90); break;
      case 'throw': tone(200, 0, 0.25, 'sine', 0.03, 420); break;
      case 'combo': [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.12, 'square', 0.04)); break;
      case 'round': tone(392, 0, 0.15, 'square', 0.04); break;
      case 'fight': tone(587, 0, 0.22, 'square', 0.05); break;
      case 'down': tone(300, 0, 0.4, 'triangle', 0.05, 120); break;
      case 'focusOn': tone(440, 0, 0.18, 'sine', 0.04, 330); break;
      case 'focusOff': tone(330, 0, 0.14, 'sine', 0.04, 440); break;
      case 'ko': [784, 659, 523, 392].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.06)); break;
    }
  }

  // ---------- Debrief & result ----------

  function feelingLabel() {
    const f = FEELINGS.find((x) => x.value === setup.feeling);
    return f ? `${f.label} (${f.value}/5)` : '—';
  }

  function lineMeta(l) {
    if (l.kind === 'block') {
      const what = l.outcome === 'parry' ? `parried, −${l.damage} grip` : l.outcome === 'partial' ? 'partial block' : 'got through';
      return `blocked ${l.trap} · ${what}`;
    }
    return l.verdict === 'vague' ? `too vague, −${l.damage}` : `−${l.damage} grip`;
  }

  function resultData() {
    const best = strongestLine(fight);
    const action = bestAction(fight);
    return {
      date: api.formatDate(setup.finishedAt || new Date()),
      situation: slotValue(setup.situation),
      thought: sanitizeText(setup.thought, TUNING.thoughtMaxChars),
      fear: slotValue(setup.fear),
      who: slotValue(setup.who),
      emotions: emotionNames(),
      intensityBefore: setup.intensity,
      intensityAfter: setup.intensityAfter,
      beliefBefore: setup.belief,
      beliefAfter: setup.beliefAfter,
      balanced: fight.balanced,
      balancedBelief: fight.balanced ? fight.balancedBelief : null,
      feeling: feelingLabel(),
      ending: fight.ended === 'ko' ? 'K.O.' : `After round ${TUNING.rounds}`,
      fightMs: sim.fightMs,
      parries: fight.parries,
      knockdowns: fight.knockdowns,
      bestStreak: fight.bestStreak,
      traps: topBlockedTraps(fight),
      breathCycles: fight.breathCycles,
      evidence: fight.evidence,
      groups: MOVES
        .map((m) => ({ title: m.name, lines: fight.log.filter((l) => l.move === m.id).map((l) => ({ text: l.line, meta: lineMeta(l) })) }))
        .filter((g) => g.lines.length),
      bestCounter: best ? best.line : '',
      action: action ? action.line : '',
    };
  }

  function dl(rows) {
    const list = document.createElement('dl');
    list.className = 'facts';
    rows.forEach(([k, v]) => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      d.append(dt, dd);
      list.appendChild(d);
    });
    return list;
  }

  function barRows(b) {
    const wrap = document.createElement('div');
    wrap.className = 'bars';
    [['Before', b.before, 'bar-before'], ['After', b.after, 'bar-after']].forEach(([k, v, cls]) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const lab = document.createElement('span');
      lab.className = 'bar-label';
      lab.textContent = k;
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('span');
      fill.className = `bar-fill ${cls}`;
      fill.style.width = `${v}%`;
      bar.appendChild(fill);
      const num = document.createElement('span');
      num.className = 'bar-num';
      num.textContent = String(v);
      row.append(lab, bar, num);
      wrap.appendChild(row);
    });
    return wrap;
  }

  const TONES = { context: 'tone-spiral', emotion: 'belief', belief: 'belief', balanced: 'tone-likely', feeling: 'tone-good', stats: 'tone-good', lines: 'tone-move' };

  function renderResult() {
    setup.finishedAt = setup.finishedAt || new Date();
    const d = resultData();
    $('#f-card-date').textContent = d.date;
    const body = $('#f-result-body');
    body.textContent = '';
    resultSections(d).forEach((s) => {
      const sec = document.createElement('section');
      sec.className = `card-sec ${TONES[s.id] || ''}`;
      sec.dataset.section = s.id;
      const h = document.createElement('h2');
      h.textContent = s.bar ? `${s.title}: ${s.bar.before} → ${s.bar.after}` : s.title;
      sec.appendChild(h);
      if (s.text) {
        const p = document.createElement('p');
        p.className = 'echo-text';
        p.textContent = s.text;
        sec.appendChild(p);
      }
      if (s.bar) sec.appendChild(barRows(s.bar));
      if (s.rows && s.rows.length) sec.appendChild(dl(s.rows));
      if (s.id === 'lines') {
        const groups = [];
        if (s.evidence) groups.push({ title: COPY.evidenceSection, lines: [{ text: s.evidence, meta: 'Round 0' }] });
        groups.push(...s.groups);
        groups.forEach((g) => {
          const h3 = document.createElement('h3');
          h3.textContent = g.title;
          const ul = document.createElement('ul');
          g.lines.forEach((l) => {
            const li = document.createElement('li');
            li.textContent = l.text;
            const meta = document.createElement('span');
            meta.className = 'line-dmg';
            meta.textContent = ` (${l.meta})`;
            li.appendChild(meta);
            ul.appendChild(li);
          });
          sec.append(h3, ul);
        });
      }
      body.appendChild(sec);
    });
    $('#f-coping-intro').textContent = COPY.copingIntro;
    const rows = $('#f-coping-rows');
    rows.textContent = '';
    copingCard(d).forEach(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      rows.append(dt, dd);
    });
    $('#f-closing').textContent = COPY.closing;
  }

  function download(kind) {
    setup.finishedAt = setup.finishedAt || new Date();
    const d = resultData();
    const name = `flip-fight-${api.fileStamp(setup.finishedAt)}.${kind}`;
    if (kind === 'md') api.downloadFile(name, buildResultMarkdown(d, FOOTER), 'text/markdown');
    else api.downloadFile(name, buildResultText(d, FOOTER), 'text/plain');
    setup.downloaded = true;
    $('#hint-f12').textContent = `Downloaded ${name}. It's only on your device.`;
  }

  function printOnly(which) {
    document.body.classList.add(`print-${which}`);
    const done = () => document.body.classList.remove('print-result', 'print-coping');
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    window.setTimeout(done, 1500);
  }

  // ---------- Reset / again ----------

  function clearArena() {
    stopLoop();
    sim = null;
    fight = null;
    document.body.classList.remove('arena-mode');
  }

  function reset() {
    clearArena();
    setup = freshSetup();
    [el.situation, el.other, el.thought, el.fear, el.who].forEach((i) => { i.value = ''; });
    $$('input[name="f-emotion"]').forEach((i) => { i.checked = false; });
    setRange(el.intensity, el.intensityOut, 60);
    setRange(el.belief, el.beliefOut, 50);
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });
    $('#hint-f12').textContent = '';
  }

  function fightAgain() {
    clearArena();
    setup.belief = setup.beliefAfter;
    setup.intensity = setup.intensityAfter;
    setup.finishedAt = null;
    setRange(el.belief, el.beliefOut, setup.belief);
    setRange(el.intensity, el.intensityOut, setup.intensity);
    $('#hint-f12').textContent = '';
    show('f6');
  }

  // ---------- Layout ----------

  function syncViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
    if (document.body.classList.contains('arena-mode')) window.scrollTo(0, 0);
  }

  function fitScreen() {
    const w = el.wrap.clientWidth;
    const h = el.wrap.clientHeight;
    if (!w || !h) return;
    let sw = w;
    let sh = (w * 9) / 16;
    if (sh > h) { sh = h; sw = (h * 16) / 9; }
    el.screen.style.width = `${Math.floor(sw)}px`;
    el.screen.style.height = `${Math.floor(sh)}px`;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', syncViewport);
  if (window.ResizeObserver) new ResizeObserver(fitScreen).observe(el.wrap);

  // ---------- Wiring ----------

  [['situation', el.situation], ['thought', el.thought], ['fear', el.fear], ['who', el.who], ['otherEmotion', el.other]].forEach(([key, input]) => {
    input.addEventListener('input', () => {
      setup[key] = input.value;
      touch();
      if (key === 'thought') thoughtGate();
      if (key === 'otherEmotion') feelingsGate();
    });
  });
  el.emotions.addEventListener('change', () => {
    setup.emotions = $$('input[name="f-emotion"]:checked').map((i) => i.value);
    touch();
    feelingsGate();
  });
  el.intensity.addEventListener('input', () => {
    setup.intensity = Number(el.intensity.value);
    setRange(el.intensity, el.intensityOut, setup.intensity);
  });
  el.belief.addEventListener('input', () => {
    setup.belief = Number(el.belief.value);
    setRange(el.belief, el.beliefOut, setup.belief);
    updatePreview();
  });
  el.beliefAfter.addEventListener('input', () => {
    setup.beliefAfter = Number(el.beliefAfter.value);
    setup.finishedAt = null;
    setRange(el.beliefAfter, el.beliefAfterOut, setup.beliefAfter);
  });
  el.intensityAfter.addEventListener('input', () => {
    setup.intensityAfter = Number(el.intensityAfter.value);
    setup.finishedAt = null;
    setRange(el.intensityAfter, el.intensityAfterOut, setup.intensityAfter);
  });
  el.balancedBelief.addEventListener('input', () => setRange(el.balancedBelief, el.balancedBeliefOut, Number(el.balancedBelief.value)));
  el.feelings.addEventListener('change', (e) => {
    if (e.target.name !== 'f-feeling') return;
    setup.feeling = Number(e.target.value);
    setup.finishedAt = null;
    overallGate();
  });
  el.moves.addEventListener('change', (e) => {
    if (e.target.name !== 'f-move' || !sim) return;
    selectMove(e.target.value);
  });

  el.line.addEventListener('focus', keyActivity);
  el.line.addEventListener('input', keyActivity);
  el.form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  el.evidence.addEventListener('input', evidenceGate);
  el.round0.addEventListener('submit', (e) => { e.preventDefault(); submitEvidence(); });
  el.balancedText.addEventListener('input', balancedGate);
  el.balancedForm.addEventListener('submit', (e) => { e.preventDefault(); submitBalanced(); });
  el.balancedBack.addEventListener('click', closeBalanced);
  el.finisher.addEventListener('click', () => {
    if (fight && fight.finisherReady && !fight.ended && !sim.paused) openBalanced('ko');
  });
  el.helpBtn.addEventListener('click', () => {
    const open = el.help.hidden;
    el.help.hidden = !open;
    el.helpBtn.setAttribute('aria-expanded', String(open));
  });

  function overallGate() {
    const ok = setup.feeling !== null;
    setHint('#hint-f11', ok ? '' : 'Pick the one that fits best. There are no wrong answers.');
    return setGate('overall', ok);
  }

  document.addEventListener('click', (e) => {
    const sw = e.target.closest('.switch');
    if (sw) {
      const key = sw.dataset.setting;
      settings[key] = !settings[key];
      if (key === 'sound' && settings.sound) {
        ensureAudio();
        if (audio) tone(660, 0, 0.08, 'square', 0.04);
      }
      syncSwitches();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'fight-start': start(); break;
      case 'f-go': {
        const from = setup.screen;
        if (GATES[from] && !GATES[from]()) { nudge(`#hint-${from}`); break; }
        show(btn.dataset.to);
        if (btn.dataset.to === 'f11') overallGate();
        break;
      }
      case 'f-skip': {
        const key = btn.dataset.skip;
        setup[key] = '';
        el[key].value = '';
        const next = { situation: 'f2', fear: 'f5', who: 'f6' }[key];
        show(next);
        break;
      }
      case 'f-fight': enterArena(); break;
      case 'f-pause': pause(); break;
      case 'f-resume': resume(); break;
      case 'f-leave': api.askReset(); break;
      case 'f-skip-breath':
        if (sim && !el.breathe.hidden && !sim.paused) doRecover('skip');
        break;
      case 'f-balanced-done': balancedDone(); break;
      case 'f-debrief': goDebrief(); break;
      case 'f-result':
        if (!overallGate()) { nudge('#hint-f11'); break; }
        renderResult();
        show('f12');
        break;
      case 'f-dl-md': download('md'); break;
      case 'f-dl-txt': download('txt'); break;
      case 'f-print': printOnly(btn.dataset.print); break;
      case 'f-again': fightAgain(); break;
    }
  });

  syncSwitches();
  setRange(el.intensity, el.intensityOut, 60);
  setRange(el.belief, el.beliefOut, 50);
  syncViewport();

  return { start, back, reset, isDirty };
}
