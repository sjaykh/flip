(() => {
  'use strict';

  // Everything lives here, in memory. Nothing is persisted or sent anywhere.
  const state = {
    step: 0,
    spiral: '',
    good: '',
    likely: '',
    move: '',
    before: 50,
    after: 50,
    afterTouched: false,
    dirty: false,
    finishedAt: null,
  };

  const INPUT_STEPS = 5;
  const MIN = { spiral: 20, likely: 20, move: 3 };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const root = document.documentElement;
  const steps = $$('.step');
  const backBtn = $('#back');
  const progress = $('#progress');
  const progressText = $('#progress-text');
  const dots = $$('.dots li');
  const themeBtn = $('#theme');
  const dialog = $('#confirm');

  const fields = {
    spiral: $('#spiral'),
    good: $('#good'),
    likely: $('#likely'),
    move: $('#move'),
  };
  const sliders = {
    before: { input: $('#before'), out: $('#before-out') },
    after: { input: $('#after'), out: $('#after-out') },
  };

  const len = (s) => s.trim().length;

  // ---------- Gates & gentle hints ----------

  function goodTarget() {
    return Math.max(MIN.spiral, Math.ceil(len(state.spiral) * 0.5));
  }

  const gates = {
    1() {
      const n = len(state.spiral);
      if (n === 0) return { ok: false, hint: 'Take your time. Write it the way it sounds in your head.' };
      if (n < MIN.spiral) return { ok: false, hint: 'A little more — a sentence or two is plenty.' };
      return { ok: true, hint: "Got it. Rate it below, then Next when you're ready." };
    },
    2() {
      const n = len(state.good);
      const target = goodTarget();
      const ratio = n / target;
      let hint;
      if (n === 0) hint = 'Same detail, same energy. Go big — it can be ridiculous.';
      else if (ratio < 0.5) hint = 'Keep going — match the energy.';
      else if (ratio < 1) hint = 'A bit more — match the energy.';
      else hint = "That's the energy. Next when you're ready.";
      return { ok: ratio >= 1, hint, meter: Math.min(1, ratio) };
    },
    3() {
      const n = len(state.likely);
      if (n === 0) return { ok: false, hint: 'Somewhere in between, probably. What does that look like?' };
      if (n < MIN.likely) return { ok: false, hint: 'A little more — what would a calm friend predict?' };
      return { ok: true, hint: "That sounds grounded. Next when you're ready." };
    },
    4() {
      const n = len(state.move);
      if (n < MIN.move) return { ok: false, hint: "A tiny step counts. So does 'nothing, let it go'." };
      return { ok: true, hint: 'Good. One move is enough.' };
    },
    5() {
      return { ok: true, hint: '' };
    },
  };

  function refreshGate(step) {
    const gate = gates[step];
    if (!gate) return;
    const { ok, hint, meter } = gate();
    const hintEl = $('#hint-' + step);
    // Only touch the live region when the message actually changes,
    // so screen readers aren't spammed on every keystroke.
    if (hintEl && hintEl.textContent !== hint) hintEl.textContent = hint;
    if (hintEl) hintEl.classList.toggle('ready', ok);
    const btn = $(`[data-gate="${step}"]`);
    if (btn) btn.setAttribute('aria-disabled', String(!ok));
    if (meter !== undefined) $('#meter-fill').style.width = Math.round(meter * 100) + '%';
    return ok;
  }

  function nudge(step) {
    const hintEl = $('#hint-' + step);
    if (!hintEl) return;
    hintEl.classList.remove('nudge');
    void hintEl.offsetWidth; // restart animation
    hintEl.classList.add('nudge');
    const field = $(`.step[data-step="${step}"] textarea`);
    if (field) field.focus();
  }

  // ---------- Navigation ----------

  function fillEchoes() {
    $$('[data-echo]').forEach((el) => {
      el.textContent = state[el.dataset.echo].trim();
    });
  }

  function updateChrome() {
    const s = state.step;
    backBtn.hidden = s === 0;
    progress.hidden = s === 0;
    if (s >= 1) {
      const shown = Math.min(s, INPUT_STEPS);
      progressText.textContent = s > INPUT_STEPS ? 'Done' : `Step ${shown} of ${INPUT_STEPS}`;
      dots.forEach((d, i) => {
        d.classList.toggle('done', i + 1 < s || s > INPUT_STEPS);
        d.classList.toggle('current', i + 1 === s);
      });
    }
  }

  function go(next) {
    const prev = state.step;
    if (next === prev) return;
    state.step = next;

    if (next === 2 || next === 3 || next === 5 || next === 6) fillEchoes();
    if (next === 5 && !state.afterTouched) setSlider('after', state.before);
    if (next === 6) renderSummary();

    steps.forEach((sec) => {
      const isNext = Number(sec.dataset.step) === next;
      sec.hidden = !isNext;
      sec.classList.toggle('entering', isNext);
    });

    updateChrome();
    refreshGate(next);
    window.scrollTo(0, 0);

    const heading = $(`#h-${next}`);
    if (heading) heading.focus({ preventScroll: true });
  }

  function tryNext() {
    const s = state.step;
    if (gates[s] && !refreshGate(s)) {
      nudge(s);
      return;
    }
    go(s + 1);
  }

  // ---------- Sliders ----------

  function setSlider(key, value) {
    const v = Math.max(0, Math.min(100, Math.round(Number(value))));
    state[key] = v;
    const { input, out } = sliders[key];
    input.value = String(v);
    out.textContent = String(v);
    input.setAttribute('aria-valuetext', `${v} out of 100`);
    input.style.setProperty('--fill', v + '%');
  }

  // ---------- Summary ----------

  function formatDate(d) {
    return d.toLocaleString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function beliefNote(before, after) {
    const diff = before - after;
    if (diff > 0) return `Down ${diff} point${diff === 1 ? '' : 's'}. That's the thought loosening its grip.`;
    if (diff === 0) return "Same as before — and that's okay. Writing it down is still the work.";
    return "It went up a little. That happens. Be gentle with yourself — try again later, or talk it through with someone you trust.";
  }

  function renderSummary() {
    state.finishedAt = state.finishedAt || new Date();
    $('#card-date').textContent = formatDate(state.finishedAt);
    $('#belief-line').textContent = `${state.before} → ${state.after}`;
    $('#num-before').textContent = String(state.before);
    $('#num-after').textContent = String(state.after);
    $('#belief-note').textContent = beliefNote(state.before, state.after);
    const bb = $('#bar-before');
    const ba = $('#bar-after');
    bb.style.width = '0';
    ba.style.width = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bb.style.width = state.before + '%';
      ba.style.width = state.after + '%';
    }));
  }

  // ---------- Export ----------

  function sections() {
    return [
      ['The spiral', state.spiral.trim()],
      ['The absurdly good version', state.good.trim()],
      ['Most likely', state.likely.trim()],
      ['One move', state.move.trim()],
    ];
  }

  function textBar(v) {
    const filled = Math.round(v / 5);
    return '█'.repeat(filled) + '░'.repeat(20 - filled);
  }

  function buildMarkdown() {
    const date = formatDate(state.finishedAt || new Date());
    const out = [`# Flip — ${date}`, ''];
    sections().forEach(([h, body]) => out.push(`## ${h}`, '', body, ''));
    out.push(
      '## Belief',
      '',
      `**${state.before} → ${state.after}**`,
      '',
      '```',
      `Before ${textBar(state.before)} ${state.before}`,
      `After  ${textBar(state.after)} ${state.after}`,
      '```',
      '',
      `_${beliefNote(state.before, state.after)}_`,
      '',
      '---',
      '',
      "_Made with Flip. This is a self-help exercise, not therapy. If you're in crisis: India — Tele-MANAS 14416 · Elsewhere — findahelpline.com_",
      ''
    );
    return out.join('\n');
  }

  function buildText() {
    const date = formatDate(state.finishedAt || new Date());
    const rule = (s, ch) => ch.repeat(Math.max(s.length, 4));
    const title = 'FLIP';
    const out = [title, date, rule(date, '='), ''];
    sections().forEach(([h, body]) => {
      const H = h.toUpperCase();
      out.push(H, rule(H, '-'), body, '');
    });
    out.push(
      'BELIEF', '------',
      `${state.before} -> ${state.after}`,
      `Before ${textBar(state.before)} ${state.before}`,
      `After  ${textBar(state.after)} ${state.after}`,
      beliefNote(state.before, state.after),
      '',
      '--',
      "This is a self-help exercise, not therapy. If you're in crisis: India - Tele-MANAS 14416 / Elsewhere - findahelpline.com",
      ''
    );
    return out.join('\n');
  }

  function fileStamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function download(kind) {
    const isMd = kind === 'md';
    const body = isMd ? buildMarkdown() : buildText();
    const blob = new Blob([body], { type: (isMd ? 'text/markdown' : 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flip-${fileStamp(state.finishedAt || new Date())}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.dirty = false;
    $('#hint-6').textContent = `Downloaded ${a.download}. It's only on your device.`;
  }

  // ---------- Reset ----------

  function resetAll() {
    Object.keys(fields).forEach((k) => {
      state[k] = '';
      fields[k].value = '';
    });
    setSlider('before', 50);
    setSlider('after', 50);
    state.afterTouched = false;
    state.dirty = false;
    state.finishedAt = null;
    $$('[data-echo]').forEach((el) => { el.textContent = ''; });
    $('#hint-6').textContent = '';
    $('details.echo').open = false;
    [1, 2, 3, 4].forEach(refreshGate);
    go(0);
  }

  function askReset() {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else if (window.confirm('Start over? This clears everything you’ve written.')) {
      resetAll();
    }
  }

  // ---------- Theme (manual toggle, memory only) ----------

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches;

  function syncThemeButton() {
    const dark = isDark();
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    const meta = $$('meta[name="theme-color"]');
    meta.forEach((m) => {
      if (root.dataset.theme) {
        m.setAttribute('content', dark ? '#1b1917' : '#f6f1ea');
      }
    });
  }

  themeBtn.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    syncThemeButton();
  });
  systemDark.addEventListener('change', syncThemeButton);

  // ---------- Wiring ----------

  Object.entries(fields).forEach(([key, el]) => {
    el.addEventListener('input', () => {
      state[key] = el.value;
      state.dirty = Object.keys(fields).some((k) => len(state[k]) > 0);
      state.finishedAt = null;
      refreshGate(state.step);
    });
    // Ctrl/Cmd + Enter moves on from a textarea.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        tryNext();
      }
    });
  });

  Object.entries(sliders).forEach(([key, { input }]) => {
    input.addEventListener('input', () => {
      if (key === 'after') state.afterTouched = true;
      setSlider(key, input.value);
      state.finishedAt = null;
      state.dirty = Object.keys(fields).some((k) => len(state[k]) > 0);
    });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'start': go(1); break;
      case 'next': tryNext(); break;
      case 'let-go':
        fields.move.value = 'Nothing, let it go.';
        fields.move.dispatchEvent(new Event('input'));
        fields.move.focus();
        break;
      case 'dl-md': download('md'); break;
      case 'dl-txt': download('txt'); break;
      case 'print': window.print(); break;
      case 'reset': askReset(); break;
      case 'cancel-reset': dialog.close(); break;
      case 'confirm-reset': dialog.close(); resetAll(); break;
    }
  });

  backBtn.addEventListener('click', () => {
    if (state.step > 0) go(state.step - 1);
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- Init ----------
  setSlider('before', 50);
  setSlider('after', 50);
  [1, 2, 3, 4].forEach(refreshGate);
  syncThemeButton();
  updateChrome();
})();
