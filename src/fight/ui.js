// Fight mode UI: screens, the game loop, input, overlays, sound and the debrief.
// Rules live in logic.js (pure), art in render.js, words and numbers in constants.js.
// All user text goes into the page with textContent only.
import {
  TUNING, MOVES, FEELINGS, COPY,
} from './constants.js';
import {
  createRng, sanitizeText, buildContext, createCommentState, nextComment,
  maybeQueueComeback, throwDelay, travelTime, projectileProgress, createFight, applyAttack,
  applyBlock, applyCommentHit, applyFinisher, recover, regenTick, tickRound, endRound,
  strongestLine, topBlockedTraps, startingAnxietyHp, anxietySize, formatDuration,
} from './logic.js';
import {
  createRenderer, drawAnxietyPreview, ARENA_W, PLAYER_X, ANXIETY_X,
} from './render.js';

export function initFight(api) {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Test-only hooks (set by scripts/check.mjs through Playwright). Real users never have them.
  const testHooks = () => window.__flipTest || {};
  if (testHooks().tuning) Object.assign(TUNING, testHooks().tuning);
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedMQ.matches;

  const el = {
    thought: $('#f-thought'),
    situation: $('#f-situation'),
    who: $('#f-who'),
    fear: $('#f-fear'),
    strength: $('#f-strength'),
    strengthOut: $('#f-strength-out'),
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
    inputArea: $('#f-input-area'),
    moves: $('#f-moves'),
    finisher: $('#f-finisher'),
    form: $('#f-form'),
    line: $('#f-line'),
    lineLabel: $('#f-line-label'),
    hitBtn: $('#f-hit-btn'),
    end: $('#f-end'),
    endMsg: $('#f-end-msg'),
    after: $('#f-after'),
    afterOut: $('#f-after-out'),
    feelings: $('#f-feelings'),
  };

  // ---------- State ----------

  const settings = { breathing: true, calm: false, sound: false };
  const freshSetup = () => ({
    screen: null,
    thought: '',
    situation: '',
    who: '',
    fear: '',
    strength: 50,
    after: 50,
    afterTouched: false,
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
    now: 0,
    phase: 'idle', // idle | intro | fight | down | breathing | between | ended
    paused: false,
    events: [],
    projectile: null,
    banner: null,
    floaters: [],
    particles: [],
    shakeUntil: 0,
    playerPose: 'idle',
    playerPoseUntil: 0,
    anxietyPose: 'idle',
    anxietyPoseUntil: 0,
    playerFlashUntil: 0,
    anxietyFlashUntil: 0,
    anxietyShown: 0.5,
    playerGhost: TUNING.playerHp,
    anxietyGhost: 100,
    fightMs: 0,
    koLit: false,
    move: MOVES[0].id,
    mode: 'off',
    endKind: null,
    statusKey: '',
  });

  // ---------- Static UI built from constants ----------

  $$('[data-rules]').forEach((ul) => {
    COPY.rules.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      ul.appendChild(li);
    });
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

  const SETTING_DEFS = [
    { key: 'breathing', label: 'Breathing breaks', desc: 'Box breathing when you get knocked down. Skippable any time.' },
    { key: 'calm', label: 'Calm pace', desc: 'Fewer, slower comments, mostly generic ones.' },
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
      const track = document.createElement('span');
      track.className = 'switch-track';
      track.setAttribute('aria-hidden', 'true');
      const state = document.createElement('span');
      state.className = 'switch-state';
      state.setAttribute('aria-hidden', 'true');
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

  function nudge(hintSel, focusEl) {
    const h = $(hintSel);
    h.classList.remove('nudge');
    void h.offsetWidth;
    h.classList.add('nudge');
    if (focusEl) focusEl.focus();
  }

  function say(text) {
    // Re-set so repeated identical announcements are still read.
    el.announce.textContent = '';
    window.setTimeout(() => { el.announce.textContent = text; }, 30);
  }

  function feedback(text, tone = '') {
    el.feedback.textContent = text;
    el.feedback.className = `f-feedback ${tone}`.trim();
  }

  // ---------- Setup screens ----------

  function thoughtGate() {
    const n = el.thought.value.trim().length;
    const hint = n === 0 ? COPY.thoughtHints.empty : n < TUNING.thoughtMinChars ? COPY.thoughtHints.short : COPY.thoughtHints.ok;
    const h = $('#hint-f1');
    if (h.textContent !== hint) h.textContent = hint;
    h.classList.toggle('ready', n >= TUNING.thoughtMinChars);
    $('[data-fgate="f1"]').setAttribute('aria-disabled', String(n < TUNING.thoughtMinChars));
    return n >= TUNING.thoughtMinChars;
  }

  function contextHint() {
    const c = buildContext(setup, setup.thought);
    let hint = '';
    if (c.safeMode) hint = COPY.safetyBanner;
    else if (!setup.situation.trim() && c.situation) hint = `If you skip the situation, anxiety will call it “${c.situation}”.`;
    const h = $('#hint-f2');
    if (h.textContent !== hint) h.textContent = hint;
  }

  function updatePreview() {
    const hp = startingAnxietyHp(setup.strength);
    el.previewHp.textContent = String(hp);
    drawAnxietyPreview(el.preview, anxietySize(hp));
    const c = buildContext(setup, setup.thought);
    el.previewQuote.textContent = c.safeMode ? '' : `“${c.thought}”`;
  }

  function feelingGate() {
    const ok = setup.feeling !== null;
    const h = $('#hint-f7');
    const hint = ok ? '' : 'Pick the one that fits best. There are no wrong answers.';
    if (h.textContent !== hint) h.textContent = hint;
    $('[data-fgate="f7"]').setAttribute('aria-disabled', String(!ok));
    return ok;
  }

  const BACK_FROM = { f1: 'home', f2: 'f1', f3: 'f2', f4: 'f3', f7: 'f6', f8: 'f7' };

  function show(id) {
    setup.screen = id;
    const inArena = id === 'f5';
    document.body.classList.toggle('arena-mode', inArena);
    api.showScreen(id, { back: Boolean(BACK_FROM[id]) });
    if (inArena) {
      syncViewport();
      fitScreen();
    } else {
      stopLoop();
    }
  }

  function start() {
    api.setMode('fight');
    show('f1');
    thoughtGate();
  }

  function back() {
    const to = BACK_FROM[setup.screen];
    if (to === 'home') api.home();
    else if (to) {
      if (to === 'f3') updatePreview();
      show(to);
    }
  }

  // ---------- Event scheduling on the sim clock (pausable) ----------

  function at(delay, fn, tag = '') {
    sim.events.push({ t: sim.now + delay, fn, tag });
  }
  function cancel(tag) {
    sim.events = sim.events.filter((e) => e.tag !== tag);
  }
  function runEvents() {
    // Events may schedule more events; loop until nothing is due.
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
      sim.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, at: sim.now, life: 0.6,
        color: colors[i % colors.length], size: 1 + (i % 2),
      });
    }
  }

  function shake(ms = 250) {
    if (!reduced()) sim.shakeUntil = sim.now + ms;
  }

  function playerPose(pose, ms) {
    sim.playerPose = pose;
    sim.playerPoseUntil = ms === Infinity ? Infinity : sim.now + ms;
  }

  function anxietyPose(pose, ms) {
    sim.anxietyPose = pose;
    sim.anxietyPoseUntil = sim.now + ms;
  }

  function anxietyTakes(dmg, kind) {
    if (dmg <= 0) return;
    floater(kind === 'big' ? `-${dmg}!` : `-${dmg}`, ANXIETY_X, 56, kind === 'weak' ? ['#d8cfe6', '#a99fc0'] : null, kind === 'big' ? 3 : 2);
    anxietyPose('hit', 260);
    if (!reduced()) sim.anxietyFlashUntil = sim.now + 90;
    if (dmg >= 8) shake(kind === 'big' ? 420 : 250);
    burst(ANXIETY_X - 14, 76, ['#fff3b0', '#ffb347', '#c9b8ff'], kind === 'big' ? 22 : 10);
    sfx(kind === 'big' ? 'big' : kind === 'weak' ? 'weak' : 'hit');
  }

  function playerTakes(dmg) {
    floater(`-${dmg}`, PLAYER_X, 50, ['#ffb3a7', '#e8483f']);
    playerPose('hit', 360);
    if (!reduced()) sim.playerFlashUntil = sim.now + 80;
    shake(220);
    sfx('hurt');
  }

  // ---------- Input modes ----------

  function moveDef(id = sim.move) {
    return MOVES.find((m) => m.id === id);
  }

  function setMode(mode) {
    sim.mode = mode;
    el.form.dataset.mode = mode;
    const off = mode === 'off' || sim.paused;
    el.line.disabled = off;
    el.hitBtn.disabled = off;
    el.finisher.disabled = off;
    $$('input[name="f-move"]').forEach((i) => { i.disabled = off; });
    if (mode === 'block' && sim.projectile) {
      el.lineLabel.textContent = COPY.blockPrompt(sim.projectile.comment.trap);
      el.line.placeholder = 'Type a specific counter, then Enter';
      el.hitBtn.textContent = 'Block';
    } else {
      const m = moveDef();
      el.lineLabel.textContent = `${m.name}: ${m.prompt}`;
      el.line.placeholder = m.prompt;
      el.hitBtn.textContent = 'Hit';
    }
  }

  function selectMove(id) {
    sim.move = id;
    $$('.move').forEach((l) => l.classList.toggle('selected', l.dataset.move === id));
    setMode(sim.mode);
  }

  function refreshMoveTicks() {
    $$('.move').forEach((l) => l.classList.toggle('landed', fight.used.includes(l.dataset.move)));
  }

  // ---------- Projectiles (anxiety's comments) ----------

  function projX(p) {
    // centre of the bubble, as a fraction of arena width
    return 0.66 - 0.36 * p;
  }

  function throwComment() {
    if (sim.phase !== 'fight' || sim.projectile) return;
    const r = nextComment(gen, ctx, rng, { calm: settings.calm });
    gen = r.gen;
    const travel = travelTime({ width: window.innerWidth, calm: settings.calm, reducedMotion: reduced() });
    sim.projectile = { comment: r.comment, launchedAt: sim.now, travel };
    el.projTrap.textContent = r.comment.trap;
    el.projText.textContent = r.comment.text;
    el.proj.className = 'projectile';
    el.proj.dataset.trap = r.comment.trapId;
    el.proj.hidden = false;
    positionProjectile(0);
    anxietyPose('throw', 420);
    sfx('throw');
    setMode('block');
    say(COPY.incoming(r.comment.trap, r.comment.text));
  }

  function positionProjectile(p) {
    el.proj.style.left = `${(projX(p) * 100).toFixed(2)}%`;
    el.proj.dataset.progress = p.toFixed(2);
  }

  function clearProjectile(how) {
    if (!sim.projectile) return;
    const p = projectileProgress(sim.projectile.launchedAt, sim.now, sim.projectile.travel);
    sim.projectile = null;
    const node = el.proj;
    node.className = `projectile ${how}`;
    if (how === 'shatter') burst(projX(p) * ARENA_W, 66, ['#ffe08a', '#c9b8ff', '#ffffff'], 24);
    window.setTimeout(() => {
      if (!sim || !sim.projectile) { node.hidden = true; node.className = 'projectile'; }
    }, reduced() ? 120 : 360);
  }

  function updateProjectile() {
    const pr = sim.projectile;
    const p = projectileProgress(pr.launchedAt, sim.now, pr.travel);
    positionProjectile(p);
    if (p >= 1) commentLands();
  }

  function commentLands() {
    const r = applyCommentHit(fight, rng);
    fight = r.fight;
    clearProjectile('impact');
    playerTakes(r.damage);
    feedback(COPY.hitTaken(r.damage), 'soft');
    say(COPY.hitTaken(r.damage));
    setMode('attack');
    afterPlayerHurt();
  }

  function scheduleNextThrow(first = false) {
    cancel('throw');
    at(first ? TUNING.firstThrowMs : throwDelay(rng, settings.calm), throwComment, 'throw');
  }

  function afterPlayerHurt() {
    if (fight.down) knockdown();
    else scheduleNextThrow();
  }

  // ---------- Player actions ----------

  function submit() {
    if (!sim || sim.phase !== 'fight' || sim.paused) return;
    const text = sanitizeText(el.line.value, TUNING.lineMaxChars);
    if (!text) {
      feedback(COPY.empty);
      el.line.focus();
      return;
    }
    el.line.value = '';
    touch();
    if (sim.projectile) doBlock(text);
    else doAttack(text);
  }

  function noteUnlock(justUnlocked) {
    if (!justUnlocked) return;
    el.finisher.hidden = false;
    banner(COPY.finisher, 900, { scale: 3 });
    feedback(COPY.finisherReady, 'good');
    say(COPY.finisherReady);
    sfx('combo');
  }

  function doAttack(text) {
    const m = moveDef();
    const r = applyAttack(fight, m.id, text, sim.now);
    fight = r.fight;
    const res = r.result;
    if (res.verdict === 'repeat') {
      feedback(COPY.repeat, 'soft');
      floater('0', ANXIETY_X, 56, ['#d8cfe6', '#a99fc0']);
      sfx('weak');
      return;
    }
    playerPose(m.anim, 300);
    anxietyTakes(res.damage, res.verdict === 'vague' ? 'weak' : 'hit');
    if (res.verdict === 'vague') {
      feedback(`${COPY.vague} (${res.damage})`, 'soft');
    } else {
      const extra = res.reasons.length ? ` · bonus: ${res.reasons.join(', ')}` : '';
      feedback(`${m.name}! ${res.damage} damage${extra}`, 'good');
      sim.streakPulse = sim.now;
      gen = maybeQueueComeback(gen, text, ctx, rng);
    }
    refreshMoveTicks();
    noteUnlock(r.justUnlocked);
    if (fight.ended === 'ko') knockOut();
  }

  function doBlock(text) {
    const m = moveDef();
    const comment = sim.projectile.comment;
    const r = applyBlock(fight, m.id, text, comment, rng, sim.now);
    fight = r.fight;
    const { outcome, result } = r;
    if (outcome.kind === 'parry') {
      clearProjectile('shatter');
      playerPose(m.anim, 300);
      anxietyTakes(outcome.anxietyDamage, 'hit');
      banner(COPY.parry, 700, { scale: 4 });
      feedback(COPY.parried(outcome.anxietyDamage), 'good');
      say(`Parry! ${comment.trap} blocked. Anxiety takes ${outcome.anxietyDamage}.`);
      sfx('parry');
      gen = maybeQueueComeback(gen, text, ctx, rng);
      refreshMoveTicks();
      noteUnlock(r.justUnlocked);
      setMode('attack');
      if (fight.ended === 'ko') { knockOut(); return; }
      scheduleNextThrow();
      return;
    }
    if (outcome.kind === 'partial') {
      clearProjectile('absorb');
      playerPose('block', 400);
      floater(`-${outcome.playerDamage}`, PLAYER_X, 50, ['#ffd6a0', '#e89a4f']);
      sfx('block');
      feedback(COPY.partial(outcome.playerDamage), 'soft');
      say(COPY.partial(outcome.playerDamage));
    } else {
      clearProjectile('impact');
      playerTakes(outcome.playerDamage);
      const why = result.verdict === 'repeat' ? `${COPY.repeat} ` : result.verdict === 'vague' ? `${COPY.vague} ` : '';
      feedback(`${why}${COPY.hitTaken(outcome.playerDamage)}`, 'soft');
      say(`${why}${COPY.hitTaken(outcome.playerDamage)}`);
    }
    setMode('attack');
    afterPlayerHurt();
  }

  function useFinisher() {
    if (!sim || sim.phase !== 'fight' || sim.paused) return;
    const r = applyFinisher(fight);
    if (!r.damage) return;
    fight = r.fight;
    touch();
    el.finisher.hidden = true;
    playerPose('uppercut', 450);
    anxietyTakes(r.damage, 'big');
    banner(COPY.finisher, 900, { scale: 4 });
    feedback(`${COPY.finisher}! ${r.damage} damage`, 'good');
    say(`${COPY.finisher}! ${r.damage} damage.`);
    if (fight.ended === 'ko') knockOut();
    else el.line.focus();
  }

  // ---------- Knockdown, breathing, recovery ----------

  function knockdown() {
    sim.phase = 'down';
    cancel('throw');
    clearProjectile('fade');
    setMode('off');
    playerPose('down', Infinity);
    banner(COPY.down, TUNING.downBannerMs, { scale: 3 });
    say(`Knocked down. ${COPY.down}.`);
    sfx('down');
    if (settings.breathing) at(1100, startBreathing, 'down');
    else at(TUNING.downBannerMs, () => doRecover('off'), 'down');
  }

  function startBreathing() {
    sim.phase = 'breathing';
    el.breathe.hidden = false;
    const phaseMs = TUNING.breathPhaseMs;
    el.breathe.style.setProperty('--phase-ms', `${phaseMs / (Number(testHooks().timeScale) || 1)}ms`);
    el.breatheMsg.textContent = COPY.breatheMessage;
    el.breatheMsg.focus({ preventScroll: true });
    say(COPY.breatheMessage);
    const phases = COPY.breathPhases;
    const total = phases.length * TUNING.breathCycles;
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
    at(650, () => {
      sim.phase = 'fight';
      setMode(sim.projectile ? 'block' : 'attack');
      scheduleNextThrow();
      if (hadFocus) el.line.focus({ preventScroll: true });
    }, 'down');
  }

  // ---------- Rounds ----------

  function startRound() {
    sim.phase = 'intro';
    setMode('off');
    banner(COPY.roundBanner(fight.round), 1000, { scale: 4 });
    sfx('round');
    say(`Round ${fight.round}.`);
    at(1100, () => {
      banner(COPY.fight, 800, { scale: 5 });
      sfx('fight');
      sim.phase = 'fight';
      fight = { ...fight, lastActivityAt: sim.now, lastRegenAt: sim.now };
      setMode('attack');
      scheduleNextThrow(true);
    }, 'intro');
  }

  function roundOver() {
    sim.phase = 'between';
    cancel('throw');
    clearProjectile('fade');
    setMode('off');
    const finishedRound = fight.round;
    fight = endRound(fight);
    banner(COPY.timeUp, 1000, { scale: 5 });
    if (fight.ended === 'timeout') {
      at(1100, () => finishFight('timeout'), 'round');
      return;
    }
    at(1000, () => {
      const best = strongestLine(fight);
      el.betweenTitle.textContent = `Round ${finishedRound} done`;
      el.betweenText.textContent = COPY.betweenRounds(fight.anxietyHp, best ? best.line : '');
      el.betweenBox.hidden = !settings.breathing;
      el.between.hidden = false;
      say(`Round ${finishedRound} done. ${el.betweenText.textContent}`);
    }, 'round');
    at(1000 + TUNING.betweenRoundsMs, () => {
      el.between.hidden = true;
      startRound();
    }, 'round');
  }

  // ---------- Endings ----------

  function knockOut() {
    finishFight('ko');
  }

  function finishFight(kind) {
    sim.phase = 'ended';
    sim.endKind = kind;
    sim.events = [];
    clearProjectile('fade');
    setMode('off');
    el.finisher.hidden = true;
    el.between.hidden = true;
    el.breathe.hidden = true;
    const msg = kind === 'ko' ? COPY.koMessage : COPY.timeoutMessage(fight.anxietyStart, fight.anxietyHp);
    if (kind === 'ko') {
      sim.koLit = true;
      banner(COPY.ko, 0, { scale: 5 });
      sfx('ko');
    } else {
      banner('TIME', 0, { scale: 5 });
      sfx('round');
    }
    say(`${kind === 'ko' ? 'K.O.! ' : ''}${msg}`);
    el.inputArea.hidden = true;
    el.help.hidden = true;
    el.end.hidden = false;
    el.endMsg.textContent = msg;
    window.setTimeout(() => el.endMsg.focus({ preventScroll: true }), 60);
    if (!setup.afterTouched) {
      setup.after = setup.strength;
      setRange(el.after, el.afterOut, setup.after);
    }
  }

  // ---------- Pause ----------

  function canPause() {
    return sim && ['intro', 'fight', 'down', 'breathing', 'between'].includes(sim.phase);
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
    if (!el.line.disabled) el.line.focus({ preventScroll: true });
    say('Resumed.');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || setup.screen !== 'f5') return;
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
    if (sim && !sim.paused && sim.phase !== 'idle') step(realDt * (Number(testHooks().timeScale) || 1));
    if (sim) draw();
  }

  function step(dt) {
    sim.now += dt;
    if (sim.phase !== 'ended') sim.fightMs += dt;
    if (sim.phase === 'fight') {
      const t = tickRound(fight, dt);
      fight = t.fight;
      const g = regenTick(fight, sim.now);
      if (g.grew) fight = g.fight;
      if (sim.projectile) updateProjectile();
      if (t.roundOver && sim.phase === 'fight') roundOver();
    }
    runEvents();
    if (!sim) return;

    // Health-bar "ghosts" drain after the real value, arcade style.
    const ease = (ghost, real) => (ghost <= real ? real : Math.max(real, ghost - dt * 0.03));
    sim.playerGhost = ease(sim.playerGhost, fight.playerHp);
    sim.anxietyGhost = ease(sim.anxietyGhost, fight.anxietyHp);
    const target = sim.endKind === 'ko' ? 0.02 : anxietySize(fight.anxietyHp);
    sim.anxietyShown += (target - sim.anxietyShown) * Math.min(1, dt / (sim.endKind === 'ko' ? 500 : 250));
    sim.floaters = sim.floaters.filter((f) => sim.now - f.at < f.life);
    sim.particles = sim.particles.filter((p) => sim.now - p.at < p.life * 1000);
    updateStatus();
  }

  function draw() {
    const now = sim.now;
    const pose = now < sim.playerPoseUntil ? sim.playerPose : (fight.down ? 'down' : 'idle');
    renderer.draw({
      t: now,
      reduced: reduced(),
      shakeUntil: sim.shakeUntil,
      particles: sim.particles,
      floaters: sim.floaters,
      playerPose: pose,
      anxietyPose: now < sim.anxietyPoseUntil ? sim.anxietyPose : 'idle',
      anxietySize: sim.anxietyShown,
      playerFlash: now < sim.playerFlashUntil,
      anxietyFlash: now < sim.anxietyFlashUntil,
      banner: sim.banner && now < sim.banner.until ? sim.banner : null,
      dim: sim.paused || sim.phase === 'breathing' || sim.phase === 'between',
      hud: {
        streak: fight.streak,
        score: fight.score,
        playerHp: fight.playerHp,
        playerMax: TUNING.playerHp,
        playerGhost: sim.playerGhost,
        anxietyHp: fight.anxietyHp,
        anxietyMax: fight.anxietyMax,
        anxietyGhost: sim.anxietyGhost,
        koLit: sim.koLit,
        playerName: COPY.playerName,
        anxietyName: COPY.opponentName,
        timer: fight.roundTimeLeftMs / 1000,
        rounds: TUNING.rounds,
        round: fight.round,
      },
    });
  }

  function updateStatus() {
    const secs = Math.ceil(fight.roundTimeLeftMs / 5000) * 5;
    const key = `${fight.playerHp}|${fight.anxietyHp}|${fight.round}|${secs}|${fight.streak}`;
    if (key === sim.statusKey) return;
    sim.statusKey = key;
    el.status.textContent = `You ${fight.playerHp} of ${TUNING.playerHp} HP. Anxiety ${fight.anxietyHp} of ${fight.anxietyMax} HP. Round ${fight.round} of ${TUNING.rounds}, about ${secs} seconds left. Streak ${fight.streak}.`;
    el.status.dataset.player = String(fight.playerHp);
    el.status.dataset.anxiety = String(fight.anxietyHp);
  }

  // ---------- Entering the arena ----------

  function enterArena() {
    ctx = buildContext(setup, setup.thought);
    const seed = Number(testHooks().seed) || ((Date.now() ^ (performance.now() * 1000)) >>> 0);
    rng = createRng(seed);
    gen = createCommentState();
    fight = createFight(setup.strength);
    sim = freshSim();
    sim.anxietyShown = anxietySize(fight.anxietyHp);
    sim.anxietyGhost = fight.anxietyHp;
    setup.afterTouched = false;
    setup.feeling = null;
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });

    el.safety.hidden = !ctx.safeMode;
    el.safety.textContent = ctx.safeMode ? COPY.safetyBanner : '';
    el.quote.textContent = ctx.safeMode ? '' : `“${ctx.thought}”`;
    el.proj.hidden = true;
    el.breathe.hidden = true;
    el.between.hidden = true;
    el.pause.hidden = true;
    el.end.hidden = true;
    el.inputArea.hidden = false;
    el.finisher.hidden = true;
    el.help.hidden = true;
    el.helpBtn.setAttribute('aria-expanded', 'false');
    el.line.value = '';
    const first = $$('input[name="f-move"]')[0];
    first.checked = true;
    selectMove(first.value);
    refreshMoveTicks();
    feedback(COPY.attackHint);

    if (!renderer) renderer = createRenderer(el.canvas);
    show('f5');
    updateStatus();
    startLoop();
    startRound();
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
      case 'big': tone(330, 0, 0.1); tone(440, 0.08, 0.1); tone(660, 0.16, 0.28, 'square', 0.06, 220); break;
      case 'parry': tone(880, 0, 0.06, 'square', 0.05); tone(1320, 0.06, 0.12, 'square', 0.05); break;
      case 'block': tone(300, 0, 0.08, 'square', 0.04); break;
      case 'hurt': tone(180, 0, 0.18, 'sawtooth', 0.04, 90); break;
      case 'throw': tone(200, 0, 0.25, 'sine', 0.03, 420); break;
      case 'combo': [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.12, 'square', 0.04)); break;
      case 'round': tone(392, 0, 0.15, 'square', 0.04); break;
      case 'fight': tone(587, 0, 0.22, 'square', 0.05); break;
      case 'down': tone(300, 0, 0.4, 'triangle', 0.05, 120); break;
      case 'ko': [784, 659, 523, 392].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.06)); break;
    }
  }

  // ---------- Debrief & result ----------

  function feelingLabel() {
    const f = FEELINGS.find((x) => x.value === setup.feeling);
    return f ? `${f.label} (${f.value}/5)` : '—';
  }

  function contextRows() {
    const rows = [];
    if (ctx.safeMode) return rows;
    if (setup.situation.trim()) rows.push(['Situation', ctx.situation]);
    if (setup.who.trim()) rows.push(['Who', ctx.who]);
    if (setup.fear.trim()) rows.push(['Fear', ctx.fear]);
    return rows;
  }

  function factRows() {
    const traps = topBlockedTraps(fight);
    const rows = [
      ['Feeling', feelingLabel()],
      ['Ended', sim.endKind === 'ko' ? 'K.O.' : `After round ${TUNING.rounds}`],
      ['Fight time', formatDuration(sim.fightMs)],
      ['Parries', String(fight.parries)],
      ['Knockdowns', String(fight.knockdowns)],
      ['Traps blocked most', traps.length ? traps.map((t) => `${t.trap} (${t.count})`).join(', ') : 'None this time'],
    ];
    if (fight.breathCycles > 0) rows.push(['Breaths taken', String(fight.breathCycles)]);
    if (fight.finisherUsed) rows.push([COPY.finisher, 'Landed']);
    return rows;
  }

  function lineMeta(l) {
    if (l.kind === 'block') {
      const what = l.outcome === 'parry' ? `parried, −${l.damage}` : l.outcome === 'partial' ? 'partial block' : 'got through';
      return `blocked ${l.trap} · ${what}`;
    }
    return l.verdict === 'vague' ? `too vague, −${l.damage}` : `−${l.damage}`;
  }

  function groupedLines() {
    return MOVES
      .map((m) => ({ title: m.name, lines: fight.log.filter((l) => l.move === m.id) }))
      .filter((g) => g.lines.length);
  }

  function fillDl(dl, rows) {
    dl.textContent = '';
    rows.forEach(([k, v]) => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      d.append(dt, dd);
      dl.appendChild(d);
    });
  }

  function renderResult() {
    setup.finishedAt = setup.finishedAt || new Date();
    $$('[data-fecho="thought"]').forEach((n) => { n.textContent = sanitizeText(setup.thought, TUNING.thoughtMaxChars); });
    $('#f-card-date').textContent = api.formatDate(setup.finishedAt);
    fillDl($('#f-ctx-out'), contextRows());
    $('#f-belief-line').textContent = `${setup.strength} → ${setup.after}`;
    $('#f-num-before').textContent = String(setup.strength);
    $('#f-num-after').textContent = String(setup.after);
    fillDl($('#f-facts-out'), factRows());

    const out = $('#f-lines-out');
    out.textContent = '';
    const groups = groupedLines();
    if (!groups.length) {
      const p = document.createElement('p');
      p.textContent = 'No lines this time. That’s okay.';
      out.appendChild(p);
    }
    groups.forEach(({ title, lines }) => {
      const h = document.createElement('h3');
      h.textContent = title;
      const ul = document.createElement('ul');
      lines.forEach((l) => {
        const li = document.createElement('li');
        li.textContent = l.line;
        const meta = document.createElement('span');
        meta.className = 'line-dmg';
        meta.textContent = ` (${lineMeta(l)})`;
        li.appendChild(meta);
        ul.appendChild(li);
      });
      out.append(h, ul);
    });

    const bb = $('#f-bar-before');
    const ba = $('#f-bar-after');
    bb.style.width = '0';
    ba.style.width = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bb.style.width = setup.strength + '%';
      ba.style.width = setup.after + '%';
    }));
  }

  function buildMarkdown() {
    const out = [`# Flip · Fight — ${api.formatDate(setup.finishedAt || new Date())}`, ''];
    out.push('## The thought', '', sanitizeText(setup.thought, TUNING.thoughtMaxChars), '');
    contextRows().forEach(([k, v]) => out.push(`- **${k}:** ${v}`));
    if (contextRows().length) out.push('');
    out.push('## Strength', '', `**${setup.strength} → ${setup.after}**`, '', '```',
      `Before ${api.textBar(setup.strength)} ${setup.strength}`,
      `After  ${api.textBar(setup.after)} ${setup.after}`, '```', '');
    out.push('## The fight', '');
    factRows().forEach(([k, v]) => out.push(`- ${k}: ${v}`));
    out.push('', '## Your counter-arguments', '');
    groupedLines().forEach(({ title, lines }) => {
      out.push(`### ${title}`, '');
      lines.forEach((l) => out.push(`- ${l.line} _(${lineMeta(l)})_`));
      out.push('');
    });
    out.push('---', '', `_${sim.endKind === 'ko' ? COPY.koMessage : COPY.timeoutMessage(fight.anxietyStart, fight.anxietyHp)}_`, '',
      "_Made with Flip. This is a self-help exercise, not therapy. If you're in crisis: India — Tele-MANAS 14416 · Elsewhere — findahelpline.com_", '');
    return out.join('\n');
  }

  function buildText() {
    const date = api.formatDate(setup.finishedAt || new Date());
    const rule = (t, ch) => ch.repeat(Math.max(t.length, 4));
    const out = ['FLIP · FIGHT', date, rule(date, '='), ''];
    const sec = (h) => out.push(h, rule(h, '-'));
    sec('THE THOUGHT');
    out.push(sanitizeText(setup.thought, TUNING.thoughtMaxChars));
    contextRows().forEach(([k, v]) => out.push(`${k}: ${v}`));
    out.push('');
    sec('STRENGTH');
    out.push(`${setup.strength} -> ${setup.after}`,
      `Before ${api.textBar(setup.strength)} ${setup.strength}`,
      `After  ${api.textBar(setup.after)} ${setup.after}`, '');
    sec('THE FIGHT');
    factRows().forEach(([k, v]) => out.push(`${k}: ${v}`));
    out.push('');
    sec('YOUR COUNTER-ARGUMENTS');
    groupedLines().forEach(({ title, lines }) => {
      out.push(`${title}:`);
      lines.forEach((l) => out.push(`  * ${l.line} (${lineMeta(l).replace('−', '-')})`));
      out.push('');
    });
    out.push('--', sim.endKind === 'ko' ? COPY.koMessage : COPY.timeoutMessage(fight.anxietyStart, fight.anxietyHp),
      "This is a self-help exercise, not therapy. If you're in crisis: India - Tele-MANAS 14416 / Elsewhere - findahelpline.com", '');
    return out.join('\n');
  }

  function download(kind) {
    const name = `flip-fight-${api.fileStamp(setup.finishedAt || new Date())}.${kind}`;
    if (kind === 'md') api.downloadFile(name, buildMarkdown(), 'text/markdown');
    else api.downloadFile(name, buildText(), 'text/plain');
    setup.downloaded = true;
    $('#hint-f8').textContent = `Downloaded ${name}. It's only on your device.`;
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
    el.thought.value = '';
    el.situation.value = '';
    el.who.value = '';
    el.fear.value = '';
    setRange(el.strength, el.strengthOut, 50);
    setRange(el.after, el.afterOut, 50);
    $$('input[name="f-feeling"]').forEach((i) => { i.checked = false; });
    $('#hint-f8').textContent = '';
    $('#hint-f2').textContent = '';
    thoughtGate();
  }

  function fightAgain() {
    clearArena();
    setup.strength = setup.after;
    setup.finishedAt = null;
    setRange(el.strength, el.strengthOut, setup.strength);
    $('#hint-f8').textContent = '';
    updatePreview();
    show('f3');
  }

  // ---------- Layout: keep a 16:9 arena + pinned controls inside the visible viewport ----------

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

  el.thought.addEventListener('input', () => {
    setup.thought = el.thought.value;
    touch();
    thoughtGate();
  });
  [['situation', el.situation], ['who', el.who], ['fear', el.fear]].forEach(([key, input]) => {
    input.addEventListener('input', () => {
      setup[key] = input.value;
      touch();
      contextHint();
    });
  });
  el.strength.addEventListener('input', () => {
    setup.strength = Number(el.strength.value);
    setRange(el.strength, el.strengthOut, setup.strength);
    updatePreview();
  });
  el.after.addEventListener('input', () => {
    setup.afterTouched = true;
    setup.after = Number(el.after.value);
    setup.finishedAt = null;
    setRange(el.after, el.afterOut, setup.after);
  });
  el.feelings.addEventListener('change', (e) => {
    if (e.target.name !== 'f-feeling') return;
    setup.feeling = Number(e.target.value);
    setup.finishedAt = null;
    feelingGate();
  });
  el.moves.addEventListener('change', (e) => {
    if (e.target.name !== 'f-move' || !sim) return;
    fight = { ...fight, lastActivityAt: sim.now };
    selectMove(e.target.value);
  });
  el.line.addEventListener('input', () => {
    if (sim && fight) fight = { ...fight, lastActivityAt: sim.now };
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  el.finisher.addEventListener('click', useFinisher);
  el.helpBtn.addEventListener('click', () => {
    const open = el.help.hidden;
    el.help.hidden = !open;
    el.helpBtn.setAttribute('aria-expanded', String(open));
  });

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
      case 'f-next1':
        if (!thoughtGate()) { nudge('#hint-f1', el.thought); break; }
        contextHint();
        show('f2');
        break;
      case 'f-skip-ctx':
        setup.situation = setup.who = setup.fear = '';
        el.situation.value = el.who.value = el.fear.value = '';
        updatePreview();
        show('f3');
        break;
      case 'f-next2':
        updatePreview();
        show('f3');
        break;
      case 'f-next3': show('f4'); break;
      case 'f-fight': enterArena(); break;
      case 'f-pause': pause(); break;
      case 'f-resume': resume(); break;
      case 'f-leave': api.askReset(); break;
      case 'f-skip-breath':
        if (sim && sim.phase === 'breathing' && !sim.paused) doRecover('skip');
        break;
      case 'f-debrief':
        stopLoop();
        $$('[data-fecho="thought"]').forEach((n) => { n.textContent = sanitizeText(setup.thought, TUNING.thoughtMaxChars); });
        show('f6');
        break;
      case 'f-to-feel': show('f7'); feelingGate(); break;
      case 'f-result':
        if (!feelingGate()) { nudge('#hint-f7'); break; }
        renderResult();
        show('f8');
        break;
      case 'f-dl-md': download('md'); break;
      case 'f-dl-txt': download('txt'); break;
      case 'f-again': fightAgain(); break;
    }
  });

  syncSwitches();
  setRange(el.strength, el.strengthOut, 50);
  setRange(el.after, el.afterOut, 50);
  thoughtGate();
  syncViewport();

  return { start, back, reset, isDirty };
}
