import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapBareMath, mathOutside } from '../src/validators/math.js';

const w = (s) => wrapBareMath(s).text;

test('maths outside $…$ is wrapped; units and brackets stay text', () => {
  assert.equal(w(String.raw`\omega – angular speed (rad s^{-1})`), String.raw`$\omega$ – angular speed (rad $s^{-1}$)`);
  assert.equal(w(String.raw`\Delta\theta – angular distance (rad)`), String.raw`$\Delta\theta$ – angular distance (rad)`);
  assert.equal(w(String.raw`a_c – centripetal acceleration (m s^{-2})`), String.raw`$a_c$ – centripetal acceleration (m $s^{-2}$)`);
  assert.equal(w(String.raw`The ratio \frac{v^2}{R} gives a_c.`), String.raw`The ratio $\frac{v^2}{R}$ gives $a_c$.`);
  assert.equal(w(String.raw`Water is \ce{H2O}.`), String.raw`Water is $\ce{H2O}$.`);
  assert.equal(w(String.raw`\Delta \theta over time`), String.raw`$\Delta \theta$ over time`, 'neighbouring tokens join one span');
});

test('clean text and ordinary words are left alone', () => {
  for (const s of ['R – radius of circle (m)', 'Already $v^2$ fine', 'see the case_study section', 'Ohm’s law: V = IR', '']) {
    assert.equal(w(s), s);
    assert.deepEqual(mathOutside(s), []);
  }
});

test('what cannot be rendered stays bare and is reported', () => {
  const s = String.raw`broken \frac{a}{`;
  assert.deepEqual(mathOutside(w(s)).length > 0, true);
});

test('G3: a formula sheet with bare LaTeX in its symbol key is repaired, and symbols render as maths', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes, checkSlideData } = await import('../src/slides.js');
  const T = slideTypes(await buildTemplates()).physics;
  const data = {
    title: 'Uniform Circular Motion: Key Relations',
    items: [
      { formula: String.raw`\omega = \frac{\Delta\theta}{\Delta t}`, label: 'Angular speed' },
      { formula: String.raw`v = R\omega`, label: 'Linear speed' },
      { formula: String.raw`v = 2\pi R\nu`, label: 'Speed and frequency' },
      { formula: String.raw`\nu = \frac{1}{T}`, label: 'Frequency and period' },
    ],
    symbols: [
      { symbol: String.raw`\omega`, meaning: 'angular speed (rad s^{-1})' },
      { symbol: 'a_c', meaning: 'centripetal acceleration (m s^{-2})' },
    ],
  };
  const r = checkSlideData(T.formula_sheet, data, { where: 's09' });
  assert.deepEqual(r.issues.filter((i) => i.severity === 'error'), []);
  assert.equal(r.data.symbols[0].meaning, 'angular speed (rad $s^{-1}$)');
  assert.equal(r.data.symbols[1].symbol, 'a_c', 'symbol fields stay bare LaTeX');
  assert.ok(r.issues.some((i) => i.code === 'LATEX_WRAPPED' && i.autoFixed));
  const bad = checkSlideData(T.formula_sheet, { ...data, symbols: [{ symbol: 'x', meaning: String.raw`broken \frac{a}{` }] }, { where: 's09' });
  assert.ok(bad.issues.some((i) => i.code === 'LATEX_OUTSIDE_MATH' && i.severity === 'error'), 'unrenderable maths goes back to the writer');
});

test('G3: a derivation goal is a maths field — never wrapped in $…$, and stray $ are removed', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes, checkSlideData } = await import('../src/slides.js');
  const T = slideTypes(await buildTemplates()).physics;
  const steps = [
    { text: 'Change in velocity over a small angle', formula: String.raw`\Delta v = v\,\Delta\theta` },
    { text: 'Divide by the time taken', formula: String.raw`a = \frac{\Delta v}{\Delta t} = v\omega` },
  ];
  const clean = checkSlideData(T.derivation, { title: 'Centripetal Acceleration', goal: String.raw`a_c = \frac{v^2}{R}`, steps }, { where: 's05' });
  assert.equal(clean.data.goal, String.raw`a_c = \frac{v^2}{R}`, 'bare LaTeX goal is left exactly as written');
  assert.deepEqual(clean.issues.filter((i) => i.severity === 'error'), []);
  const dollars = checkSlideData(T.derivation, { title: 'Centripetal Acceleration', goal: String.raw`$a_c$ = $\frac{v^2}{R}$`, steps }, { where: 's05' });
  assert.equal(dollars.data.goal, String.raw`a_c = \frac{v^2}{R}`);
  assert.ok(dollars.issues.some((i) => i.code === 'LATEX_UNWRAPPED'));
});

test('G3: a lone $ or a control character in slide text is an error, not a "$" on screen', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes, checkSlideData, words } = await import('../src/slides.js');
  const T = slideTypes(await buildTemplates()).chemistry;
  const table = (cells) => ({ title: 'Reduction Versus Decarboxylation', columns: ['Basis', 'Reduction', 'Decarboxylation'],
    rows: [['Starting material', 'Carboxylic acid', 'Sodium carboxylate'], ['Conditions', cells[0], 'Heat with soda lime'], ['Product', 'Primary alcohol', cells[1]]] });
  const codes = (r) => r.issues.filter((i) => i.severity === 'error').map((i) => i.code);
  const ok = checkSlideData(T.comparison, table([String.raw`$\ce{LiAlH4}$, then $\ce{H3O+}$`, String.raw`Hydrocarbon and $\ce{Na2CO3}$`]), { where: 's07' });
  assert.ok(!codes(ok).some((c) => c === 'UNBALANCED_MATH' || c === 'CONTROL_CHAR'), JSON.stringify(ok.issues));
  // The Lecture 4 symptoms: "Has an $", a cell that is just "$", "$<backspace>9".
  assert.ok(codes(checkSlideData(T.comparison, table(['Has an $', 'Hydrocarbon']), { where: 's07' })).includes('UNBALANCED_MATH'));
  assert.ok(codes(checkSlideData(T.comparison, table(['$', 'Hydrocarbon']), { where: 's07' })).includes('UNBALANCED_MATH'));
  assert.ok(codes(checkSlideData(T.comparison, table(['$\b9', 'Hydrocarbon']), { where: 's07' })).includes('CONTROL_CHAR'));
  // A literal dollar stays allowed.
  assert.ok(!codes(checkSlideData(T.comparison, table([String.raw`Costs \$5`, 'Hydrocarbon']), { where: 's07' })).includes('UNBALANCED_MATH'));
  // A formula is one word for the length limits.
  assert.equal(words(String.raw`Heat with $\ce{CH3COOH + PCl5 -> CH3COCl + POCl3 + HCl}$`), 3);
});
