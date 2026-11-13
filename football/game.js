/* ──────────────────────────────────────────────────────────────────────────
   Footy Legends — game logic
   Plain script (no ES module) so index.html also works opened off disk.
   Reads window.FOOTY_DATA from data.js.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var D = window.FOOTY_DATA;
  if (!D) { throw new Error('data.js must load before game.js'); }

  var PLAYERS = D.PLAYERS;
  var RECORDS = D.RECORDS;
  var QUESTIONS = D.QUESTIONS;

  var LEGEND_ROUNDS = 5;
  var QUIZ_LENGTH = 10;
  var QUIZ_SECONDS = 20;
  var CLUE_POINTS = [50, 40, 30, 20, 10];

  // ── tiny helpers ────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') { node.className = attrs[k]; }
      else if (k === 'text') { node.textContent = attrs[k]; }
      else if (k.slice(0, 2) === 'on') { node.addEventListener(k.slice(2), attrs[k]); }
      else { node.setAttribute(k, attrs[k]); }
    });
    (kids || []).forEach(function (kid) {
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function shuffle(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function sample(list, n) { return shuffle(list).slice(0, n); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  // Best scores survive a reload. Wrapped because Safari private mode throws.
  function best(key, value) {
    try {
      if (value === undefined) { return Number(localStorage.getItem('footy_' + key)) || 0; }
      if (value > best(key)) { localStorage.setItem('footy_' + key, String(value)); return true; }
    } catch (e) { /* storage unavailable — scores just don't persist */ }
    return false;
  }

  function asOfTag(player) {
    return player.asOf ? ' (as of May 2026)' : '';
  }

  // ── view routing ────────────────────────────────────────────────────────

  var VIEWS = ['home', 'legend', 'higher', 'quiz', 'fame', 'records'];
  var current = 'home';

  function show(view, fromHash) {
    if (VIEWS.indexOf(view) === -1) { view = 'home'; }
    // Leaving the quiz mid-question must kill the countdown, or it keeps
    // ticking and eventually scores an answer against a hidden view.
    if (current === 'quiz' && view !== 'quiz') { clearTimer(); }
    current = view;

    // Keep the URL in step so a view can be linked to or bookmarked.
    if (!fromHash) {
      var hash = view === 'home' ? '' : '#' + view;
      if (window.location.hash !== hash) {
        try { history.replaceState(null, '', hash || window.location.pathname); }
        catch (e) { window.location.hash = hash; }
      }
    }
    VIEWS.forEach(function (v) {
      el('view-' + v).hidden = (v !== view);
    });
    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.setAttribute('aria-current', btn.dataset.nav === view ? 'page' : 'false');
    });
    window.scrollTo(0, 0);
    if (view === 'home') { renderHome(); }
    if (view === 'legend') { startLegend(); }
    if (view === 'higher') { startHigher(); }
    if (view === 'quiz') { startQuiz(); }
    if (view === 'fame') { renderFame(); }
    if (view === 'records') { renderRecords(); }
  }

  // ── home ────────────────────────────────────────────────────────────────

  function renderHome() {
    el('best-legend').textContent = best('legend') || '—';
    el('best-higher').textContent = best('higher') || '—';
    el('best-quiz').textContent = best('quiz') ? best('quiz') + '/10' : '—';
  }

  // ── Mode 1: Guess the Legend ────────────────────────────────────────────

  var L = {};

  function startLegend() {
    L = { round: 0, score: 0 };
    nextLegendRound();
  }

  function nextLegendRound() {
    L.round++;
    if (L.round > LEGEND_ROUNDS) { return endLegend(); }

    L.target = pick(PLAYERS);
    L.cluesShown = 1;
    L.answered = false;
    L.options = buildOptions(L.target);
    renderLegend();
  }

  // Distractors have to be *plausible*, or clue 1 gives the answer away:
  // "a Spanish midfielder" is no puzzle at all when the other three options
  // are a German keeper, a Brazilian winger and an English striker. Prefer
  // players in the same position, then the same era, and only then anyone.
  function buildOptions(target) {
    var notTarget = PLAYERS.filter(function (p) { return p.id !== target.id; });
    var samePos = notTarget.filter(function (p) { return p.pos === target.pos; });
    var sameEra = notTarget.filter(function (p) {
      return p.pos !== target.pos && p.era === target.era;
    });
    var rest = notTarget.filter(function (p) {
      return p.pos !== target.pos && p.era !== target.era;
    });
    var pool = shuffle(samePos).concat(shuffle(sameEra)).concat(shuffle(rest));
    return shuffle(pool.slice(0, 3).concat([target]));
  }

  function renderLegend() {
    el('legend-progress').textContent = 'Round ' + L.round + ' of ' + LEGEND_ROUNDS;
    el('legend-score').textContent = L.score;
    el('legend-worth').textContent = CLUE_POINTS[L.cluesShown - 1];

    var clues = el('legend-clues');
    clues.innerHTML = '';
    L.target.clues.slice(0, L.cluesShown).forEach(function (clue, i) {
      clues.appendChild(h('li', { class: 'clue' }, [
        h('span', { class: 'clue-n', text: 'Clue ' + (i + 1) }),
        h('span', { text: clue }),
      ]));
    });

    var opts = el('legend-options');
    opts.innerHTML = '';
    L.options.forEach(function (p) {
      opts.appendChild(h('button', {
        class: 'opt', type: 'button', text: p.flag + '  ' + p.name,
        onclick: function () { answerLegend(p); },
      }));
    });

    el('legend-next-clue').hidden = L.cluesShown >= 5;
    el('legend-reveal').hidden = true;
    el('legend-play').hidden = false;
  }

  function answerLegend(choice) {
    if (L.answered) { return; }
    L.answered = true;
    var right = choice.id === L.target.id;
    var gained = right ? CLUE_POINTS[L.cluesShown - 1] : 0;
    L.score += gained;

    var p = L.target;
    el('legend-play').hidden = true;
    var box = el('legend-reveal');
    box.hidden = false;
    box.className = 'reveal ' + (right ? 'reveal-right' : 'reveal-wrong');
    box.innerHTML = '';
    box.appendChild(h('p', { class: 'verdict', text: right ? '✅  Correct — +' + gained + ' points' : '❌  Not quite' }));
    box.appendChild(h('h3', { class: 'reveal-name', text: p.flag + '  ' + p.name }));
    box.appendChild(h('p', { class: 'reveal-meta', text: p.pos + ' · ' + p.country + ' · born ' + p.born }));
    box.appendChild(h('p', { class: 'reveal-fact', text: p.fact }));
    box.appendChild(h('p', { class: 'reveal-honours', text: p.honours.join('  ·  ') }));
    box.appendChild(h('button', {
      class: 'btn btn-primary', type: 'button',
      text: L.round >= LEGEND_ROUNDS ? 'See your score' : 'Next legend →',
      onclick: nextLegendRound,
    }));
  }

  function endLegend() {
    var isBest = best('legend', L.score);
    el('legend-play').hidden = true;
    var box = el('legend-reveal');
    box.hidden = false;
    box.className = 'reveal reveal-final';
    box.innerHTML = '';
    box.appendChild(h('p', { class: 'final-label', text: 'Final score' }));
    box.appendChild(h('p', { class: 'final-score', text: String(L.score) }));
    box.appendChild(h('p', {
      class: 'final-note',
      text: isBest ? '🏆  New personal best!' : 'Your best is ' + best('legend') +
            '. Max possible is ' + (CLUE_POINTS[0] * LEGEND_ROUNDS) + '.',
    }));
    box.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: 'Play again', onclick: startLegend }));
    box.appendChild(h('button', { class: 'btn', type: 'button', text: 'Back to menu', onclick: function () { show('home'); } }));
  }

  // ── Mode 2: Higher or Lower ─────────────────────────────────────────────
  // Compares goals for the national team: one well-documented number, and
  // the ordering stays correct even where a figure is a little behind.

  var HI = {};

  function startHigher() {
    HI = { streak: 0, left: null, right: null };
    HI.left = pick(PLAYERS);
    drawRight();
    renderHigher();
  }

  function drawRight() {
    var pool = PLAYERS.filter(function (p) {
      return p.id !== HI.left.id && p.intlGoals !== HI.left.intlGoals;
    });
    HI.right = pick(pool);
  }

  function renderHigher() {
    el('higher-streak').textContent = HI.streak;
    el('higher-best').textContent = best('higher');
    el('hi-left-name').textContent = HI.left.flag + '  ' + HI.left.name;
    el('hi-left-meta').textContent = HI.left.country + ' · ' + HI.left.pos;
    el('hi-left-value').textContent = HI.left.intlGoals;
    el('hi-left-asof').textContent = asOfTag(HI.left);
    el('hi-right-name').textContent = HI.right.flag + '  ' + HI.right.name;
    el('hi-right-meta').textContent = HI.right.country + ' · ' + HI.right.pos;
    el('hi-right-value').textContent = '?';
    el('hi-right-asof').textContent = '';
    el('higher-buttons').hidden = false;
    el('higher-result').hidden = true;
  }

  function answerHigher(saidMore) {
    var actuallyMore = HI.right.intlGoals > HI.left.intlGoals;
    var right = saidMore === actuallyMore;

    el('hi-right-value').textContent = HI.right.intlGoals;
    el('hi-right-asof').textContent = asOfTag(HI.right);
    el('higher-buttons').hidden = true;

    var box = el('higher-result');
    box.hidden = false;
    box.innerHTML = '';

    if (right) {
      HI.streak++;
      best('higher', HI.streak);
      box.className = 'result result-right';
      box.appendChild(h('p', { class: 'verdict', text: '✅  Right — streak ' + HI.streak }));
      box.appendChild(h('button', {
        class: 'btn btn-primary', type: 'button', text: 'Keep going →',
        onclick: function () { HI.left = HI.right; drawRight(); renderHigher(); },
      }));
    } else {
      box.className = 'result result-wrong';
      box.appendChild(h('p', { class: 'verdict', text: '❌  Out! Streak ended at ' + HI.streak }));
      box.appendChild(h('p', {
        class: 'result-note',
        text: HI.right.name + ' scored ' + HI.right.intlGoals + ' for ' + HI.right.country +
              ', ' + HI.left.name + ' scored ' + HI.left.intlGoals + '.',
      }));
      box.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: 'Try again', onclick: startHigher }));
      box.appendChild(h('button', { class: 'btn', type: 'button', text: 'Back to menu', onclick: function () { show('home'); } }));
    }
  }

  // ── Mode 3: Quiz ────────────────────────────────────────────────────────

  var Q = {};

  function startQuiz() {
    Q = { items: sample(QUESTIONS, QUIZ_LENGTH), idx: 0, score: 0, timer: null };
    renderQuestion();
  }

  function clearTimer() {
    if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
  }

  function renderQuestion() {
    clearTimer();
    if (Q.idx >= Q.items.length) { return endQuiz(); }
    var item = Q.items[Q.idx];

    el('quiz-progress').textContent = 'Question ' + (Q.idx + 1) + ' of ' + Q.items.length;
    el('quiz-score').textContent = Q.score;
    el('quiz-question').textContent = item.q;
    el('quiz-feedback').hidden = true;
    el('quiz-answers').hidden = false;

    var wrap = el('quiz-answers');
    wrap.innerHTML = '';
    item.a.forEach(function (text, i) {
      wrap.appendChild(h('button', {
        class: 'opt', type: 'button', text: text,
        onclick: function () { answerQuiz(i); },
      }));
    });

    // Countdown: running out counts as a wrong answer, which keeps the
    // pressure on without ever skipping the explanation.
    var left = QUIZ_SECONDS;
    var bar = el('quiz-timer-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    el('quiz-timer-label').textContent = left + 's';
    Q.timer = setInterval(function () {
      left--;
      bar.style.transition = 'width 0.9s linear';
      bar.style.width = Math.max(0, (left / QUIZ_SECONDS) * 100) + '%';
      el('quiz-timer-label').textContent = Math.max(0, left) + 's';
      if (left <= 0) { answerQuiz(-1); }
    }, 1000);
  }

  function answerQuiz(chosen) {
    clearTimer();
    var item = Q.items[Q.idx];
    var right = chosen === item.correct;
    if (right) { Q.score++; }

    el('quiz-answers').hidden = true;
    el('quiz-score').textContent = Q.score;

    var box = el('quiz-feedback');
    box.hidden = false;
    box.className = 'reveal ' + (right ? 'reveal-right' : 'reveal-wrong');
    box.innerHTML = '';
    box.appendChild(h('p', {
      class: 'verdict',
      text: right ? '✅  Correct' : (chosen === -1 ? '⏱  Time up' : '❌  Wrong'),
    }));
    if (!right) {
      box.appendChild(h('p', { class: 'reveal-meta', text: 'Answer: ' + item.a[item.correct] }));
    }
    box.appendChild(h('p', { class: 'reveal-fact', text: item.why }));
    box.appendChild(h('button', {
      class: 'btn btn-primary', type: 'button',
      text: Q.idx + 1 >= Q.items.length ? 'See your score' : 'Next question →',
      onclick: function () { Q.idx++; renderQuestion(); },
    }));
  }

  function endQuiz() {
    var isBest = best('quiz', Q.score);
    el('quiz-answers').hidden = true;
    var grades = [
      [10, '🏆  Perfect. You know your football.'],
      [8, '🔥  Excellent.'],
      [6, '👏  Solid.'],
      [4, '🙂  Not bad — go round again.'],
      [0, '📚  Try the Hall of Fame, then come back.'],
    ];
    var grade = grades.find(function (g) { return Q.score >= g[0]; })[1];

    var box = el('quiz-feedback');
    box.hidden = false;
    box.className = 'reveal reveal-final';
    box.innerHTML = '';
    box.appendChild(h('p', { class: 'final-label', text: 'You scored' }));
    box.appendChild(h('p', { class: 'final-score', text: Q.score + '/' + Q.items.length }));
    box.appendChild(h('p', { class: 'final-note', text: grade + (isBest ? '  New personal best!' : '') }));
    box.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: 'New questions', onclick: startQuiz }));
    box.appendChild(h('button', { class: 'btn', type: 'button', text: 'Back to menu', onclick: function () { show('home'); } }));
  }

  // ── Hall of Fame ────────────────────────────────────────────────────────

  var fameFilter = 'all';

  function renderFame() {
    var wrap = el('fame-grid');
    wrap.innerHTML = '';

    var list = PLAYERS.filter(function (p) {
      if (fameFilter === 'all') { return true; }
      if (fameFilter === 'keeper') { return p.pos === 'Goalkeeper'; }
      return p.era === fameFilter;
    }).sort(function (a, b) { return a.born - b.born; });

    el('fame-count').textContent = list.length + ' players';

    list.forEach(function (p) {
      wrap.appendChild(h('article', { class: 'fame-card' }, [
        h('div', { class: 'fame-head' }, [
          h('span', { class: 'fame-flag', text: p.flag }),
          h('div', {}, [
            h('h3', { class: 'fame-name', text: p.name }),
            h('p', { class: 'fame-meta', text: p.pos + ' · ' + p.country + ' · b. ' + p.born }),
          ]),
        ]),
        h('p', { class: 'fame-fact', text: p.fact }),
        h('ul', { class: 'fame-honours' }, p.honours.map(function (hn) {
          return h('li', { text: hn });
        })),
        h('p', { class: 'fame-clubs', text: p.clubs.join(' → ') }),
        h('p', { class: 'fame-goals' }, [
          h('strong', { text: String(p.intlGoals) }),
          h('span', { text: ' goals for ' + p.country + asOfTag(p) }),
        ]),
      ]));
    });
  }

  // ── Records ─────────────────────────────────────────────────────────────
  // One measure per table, so each is a single-series ranked bar: one hue,
  // length carries magnitude, every value directly labelled.

  function renderRecords() {
    var wrap = el('records-wrap');
    if (wrap.dataset.rendered) { return; }
    wrap.dataset.rendered = '1';

    RECORDS.forEach(function (table) {
      var max = Math.max.apply(null, table.rows.map(function (r) { return r.value; }));

      var rows = table.rows.map(function (r, i) {
        return h('div', { class: 'rec-row' }, [
          h('span', { class: 'rec-rank', text: String(i + 1) }),
          h('span', { class: 'rec-name' }, [
            h('span', { text: r.name }),
            r.detail ? h('span', { class: 'rec-detail', text: r.detail }) : h('span'),
          ]),
          h('span', { class: 'rec-bar-track', title: r.name + ' — ' + r.value + ' ' + table.unit }, [
            h('span', {
              class: 'rec-bar',
              style: 'width:' + ((r.value / max) * 100) + '%',
            }),
          ]),
          h('span', { class: 'rec-value', text: String(r.value) + (r.verify ? ' *' : '') }),
        ]);
      });

      wrap.appendChild(h('section', { class: 'rec-table' }, [
        h('h3', { class: 'rec-title', text: table.title }),
        h('p', { class: 'rec-sub', text: table.subtitle + ' · figures in ' + table.unit }),
        h('div', { class: 'rec-rows' }, rows),
      ]));
    });
  }

  // ── wiring ──────────────────────────────────────────────────────────────

  function init() {
    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () { show(btn.dataset.nav); });
    });

    el('legend-next-clue').addEventListener('click', function () {
      if (L.cluesShown < 5) { L.cluesShown++; renderLegend(); }
    });
    el('hi-more').addEventListener('click', function () { answerHigher(true); });
    el('hi-fewer').addEventListener('click', function () { answerHigher(false); });

    document.querySelectorAll('[data-fame-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        fameFilter = btn.dataset.fameFilter;
        document.querySelectorAll('[data-fame-filter]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        renderFame();
      });
    });

    el('data-stamp').textContent = D.VERIFIED_THROUGH;

    window.addEventListener('hashchange', function () {
      show(window.location.hash.replace('#', '') || 'home', true);
    });

    // Keyboard shortcuts — teenagers speedrun things.
    document.addEventListener('keydown', function (ev) {
      if (ev.target.tagName === 'INPUT') { return; }
      if (current === 'higher' && !el('higher-buttons').hidden) {
        if (ev.key === 'ArrowUp') { answerHigher(true); }
        if (ev.key === 'ArrowDown') { answerHigher(false); }
      }
      if (current === 'legend' && ev.key === 'c' && !el('legend-next-clue').hidden) {
        el('legend-next-clue').click();
      }
      if (ev.key === 'Escape' && current !== 'home') { show('home'); }
    });

    show(window.location.hash.replace('#', '') || 'home', true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
