// Feature Finder guardrail tests — no dependencies, run with: node tests/feature-finder.test.mjs
// Validates the question bank against the live feature data and ensures the
// embedded fallback (in index.html) stays identical to the canonical
// FEATURE_THEMES exported from bronco-data.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { DATA, FEATURE_THEMES } = await import('file://' + join(ROOT, 'bronco-data.js'));

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

// --- Extract the embedded THEMES fallback from the bundled index.html --------
function embeddedThemes() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const line = html.split('\n')[182]; // bundler template (1-based line 183)
  const decoded = JSON.parse(line);
  const m = decoded.match(/static THEMES = (\[[\s\S]*?\n  \]);/);
  assert.ok(m, 'embedded static THEMES array not found in index.html');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + m[1])();
}

// --- Flatten feature_comparison to { name: [codes...] } -----------------------
function flatFeatures() {
  const out = {};
  const walk = (o) => { for (const k in o) { if (k[0] === '_') continue; const v = o[k]; if (Array.isArray(v)) out[k] = v; else if (v && typeof v === 'object') walk(v); } };
  walk(DATA.feature_comparison);
  return out;
}
const matchedNames = (theme, feats) => {
  const ex = theme.exclude || [];
  return Object.keys(feats).filter((n) => { const l = n.toLowerCase(); return theme.match.some((p) => l.includes(p)) && !ex.some((e) => l.includes(e)); });
};

const feats = flatFeatures();
const order = DATA.feature_comparison._trim_order;

// 1. Embedded fallback must equal the canonical data export (no drift).
assert.deepStrictEqual(embeddedThemes(), FEATURE_THEMES, 'embedded THEMES drifted from bronco-data.js FEATURE_THEMES');
ok('embedded THEMES fallback matches bronco-data.js FEATURE_THEMES');

// 2. Theme shape is well-formed and ids are unique.
const ids = new Set();
for (const t of FEATURE_THEMES) {
  assert.ok(t.id && t.term && t.q && t.section, `theme missing fields: ${JSON.stringify(t)}`);
  assert.ok(Array.isArray(t.match) && t.match.length, `theme ${t.id} has no match patterns`);
  assert.ok(!ids.has(t.id), `duplicate theme id: ${t.id}`);
  ids.add(t.id);
}
ok(`${FEATURE_THEMES.length} themes well-formed with unique ids`);

// 3. Every theme maps to at least one real feature, and not an unreasonable
//    number (a blown-out count signals a noisy substring match).
for (const t of FEATURE_THEMES) {
  const ms = matchedNames(t, feats);
  assert.ok(ms.length >= 1, `theme ${t.id} matches NO features (patterns: ${t.match})`);
  assert.ok(ms.length <= 12, `theme ${t.id} matches ${ms.length} features — likely noisy: ${ms.join(' | ')}`);
}
ok('every theme matches 1–12 real features');

// 4. The Sasquatch exclude list keeps out the known noise (spare-tire covers,
//    splash guards, graphics, "requires" mentions).
const sas = FEATURE_THEMES.find((t) => t.id === 'sasquatch');
const sasNames = matchedNames(sas, feats).map((n) => n.toLowerCase());
for (const bad of ['spare tire', 'splash', 'graphics']) {
  assert.ok(!sasNames.some((n) => n.includes(bad)), `sasquatch wrongly matched a "${bad}" feature`);
}
assert.ok(sasNames.some((n) => n === 'sasquatch package'), 'sasquatch should match the Sasquatch Package itself');
ok('sasquatch exclude list filters noise but keeps the package');

// 5. Availability resolves to S/O/NA per trim and at least one theme actually
//    differentiates trims (otherwise the recommender can never pick a winner).
const avail = (t, i) => { const s = new Set(matchedNames(t, feats).map((n) => feats[n][i])); return s.has('S') ? 'S' : (s.has('O') ? 'O' : 'NA'); };
let differentiates = 0;
for (const t of FEATURE_THEMES) {
  const codes = new Set(order.map((_, i) => avail(t, i)));
  for (const c of codes) assert.ok(['S', 'O', 'NA'].includes(c), `bad availability code ${c} for ${t.id}`);
  if (codes.size > 1) differentiates++;
}
assert.ok(differentiates >= FEATURE_THEMES.length - 2, `only ${differentiates} themes differentiate trims`);
ok(`${differentiates}/${FEATURE_THEMES.length} themes differentiate across trims`);

console.log(`\nAll ${passed} checks passed.`);
