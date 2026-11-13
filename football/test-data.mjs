// Consistency checks for football/data.js. Run after editing the data:
//
//   node football/test-data.mjs
//
// These catch the mistakes that break a game silently — a quiz answer index
// pointing at nothing, a records table that isn't sorted so the ranks lie, a
// player nobody can be compared against in Higher or Lower.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'data.js'), 'utf8');
const D = new Function(
  src + '; return { VERIFIED_THROUGH, PLAYERS, RECORDS, QUESTIONS };')();

let checks = 0;
const fails = [];
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

// ── players ───────────────────────────────────────────────────────────────
const ids = new Set();
for (const p of D.PLAYERS) {
  const at = `player ${p.id || '(no id)'}`;
  ok(!!p.id, `${at}: missing id`);
  ok(!ids.has(p.id), `${at}: duplicate id`);
  ids.add(p.id);

  for (const field of ['name', 'country', 'flag', 'pos', 'fact', 'era']) {
    ok(typeof p[field] === 'string' && p[field].length > 0,
       `${at}: ${field} missing or empty`);
  }
  ok(['classic', 'modern'].includes(p.era), `${at}: era must be classic|modern`);
  ok(Number.isInteger(p.born) && p.born > 1900 && p.born < 2015,
     `${at}: implausible birth year ${p.born}`);
  ok(Number.isInteger(p.intlGoals) && p.intlGoals >= 0,
     `${at}: intlGoals must be a non-negative integer`);
  ok(Array.isArray(p.clues) && p.clues.length === 5,
     `${at}: needs exactly 5 clues, has ${p.clues?.length}`);
  ok((p.clues || []).every(c => typeof c === 'string' && c.length > 10),
     `${at}: a clue is missing or too short`);
  ok(Array.isArray(p.honours) && p.honours.length > 0, `${at}: no honours`);
  ok(Array.isArray(p.clubs) && p.clubs.length > 0, `${at}: no clubs`);

  // An active player's figure must be dated, or the UI silently implies
  // it is final.
  if (p.asOf) {
    ok(/^\d{4}-\d{2}$/.test(p.asOf), `${at}: asOf should look like 2026-05`);
  }
}

// Guess the Legend needs 4 distinct options per round.
ok(D.PLAYERS.length >= 4, 'need at least 4 players for multiple choice');

// Higher or Lower picks an opponent with a DIFFERENT goal tally. If any
// player has no such counterpart, that round can deadlock.
for (const p of D.PLAYERS) {
  const others = D.PLAYERS.filter(o => o.id !== p.id && o.intlGoals !== p.intlGoals);
  ok(others.length > 0,
     `player ${p.id}: nobody to compare against (every other player has ${p.intlGoals} goals)`);
}

// ── quiz ──────────────────────────────────────────────────────────────────
const prompts = new Set();
D.QUESTIONS.forEach((q, i) => {
  const at = `question ${i + 1}`;
  ok(typeof q.q === 'string' && q.q.length > 10, `${at}: prompt missing`);
  ok(!prompts.has(q.q), `${at}: duplicate prompt`);
  prompts.add(q.q);
  ok(Array.isArray(q.a) && q.a.length === 4, `${at}: needs exactly 4 options`);
  ok(new Set(q.a).size === (q.a || []).length, `${at}: duplicate options`);
  ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < (q.a || []).length,
     `${at}: correct index ${q.correct} out of range`);
  ok(typeof q.why === 'string' && q.why.length > 10, `${at}: no explanation`);
});
ok(D.QUESTIONS.length >= 10, 'quiz draws 10 questions, so need at least 10');

// ── records ───────────────────────────────────────────────────────────────
const tableIds = new Set();
for (const t of D.RECORDS) {
  const at = `records table ${t.id}`;
  ok(!!t.id && !tableIds.has(t.id), `${at}: missing or duplicate id`);
  tableIds.add(t.id);
  for (const field of ['title', 'subtitle', 'unit']) {
    ok(typeof t[field] === 'string' && t[field].length > 0, `${at}: ${field} missing`);
  }
  ok(Array.isArray(t.rows) && t.rows.length >= 3, `${at}: needs at least 3 rows`);

  let previous = Infinity;
  t.rows.forEach((r, i) => {
    ok(typeof r.name === 'string' && r.name.length > 0, `${at} row ${i + 1}: no name`);
    ok(typeof r.value === 'number' && r.value > 0,
       `${at} row ${i + 1}: value must be a positive number`);
    // The UI prints a rank number per row, so descending order isn't
    // cosmetic — out of order means the displayed rank is wrong.
    ok(r.value <= previous,
       `${at} row ${i + 1} (${r.name}): ${r.value} breaks descending order`);
    previous = r.value;
  });
}

// ── report ────────────────────────────────────────────────────────────────
const flagged = [
  ...D.PLAYERS.filter(p => p.verify).map(p => `player: ${p.name}`),
  ...D.RECORDS.flatMap(t => t.rows.filter(r => r.verify)
    .map(r => `${t.id}: ${r.name}`)),
];

console.log(`${checks} checks run on ${D.PLAYERS.length} players, ` +
            `${D.QUESTIONS.length} questions, ${D.RECORDS.length} records tables`);
console.log(`data verified through: ${D.VERIFIED_THROUGH}`);
console.log(`\n${flagged.length} figures flagged for verification:`);
flagged.forEach(f => console.log(`  * ${f}`));

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  fails.forEach(f => console.log('  ✗', f));
  process.exit(1);
}
console.log('\nall passed ✓');
