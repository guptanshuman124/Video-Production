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

test('G3: a worked example too tall for its card goes back to the writer; lecture 2602 fits in two columns', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes, checkSlideData } = await import('../src/slides.js');
  const T = slideTypes(await buildTemplates()).mathematics;
  const M = String.raw`\begin{bmatrix}4&4&4&-7\\35&-2&-39&22\\31&2&-27&11\end{bmatrix}`;
  const ex = (n) => ({
    title: 'Verify Associativity',
    problem: String.raw`If $A=\begin{bmatrix}1&1&-1\\2&0&3\\3&-1&2\end{bmatrix}$ and $B=\begin{bmatrix}1&3\\0&2\\-1&4\end{bmatrix}$, show that $(AB)C=A(BC)$.`,
    steps: Array.from({ length: n }, (_, i) => ({ text: `Step ${i + 1}: multiply.`, formula: `X_${i}=${M}` })),
    answer: `Thus, $(AB)C=A(BC)=${M}$.`,
    tip: 'Regroup the factors; do not change their order.',
  });
  const errors = (d) => checkSlideData(T.solved_example, d, { where: 's03' }).issues.filter((i) => i.code === 'TEMPLATE_CHECK');
  assert.deepEqual(errors(ex(4)), [], 'four 3-row matrices fit in two columns (measured in the stage)');
  const tall = errors(ex(6));
  assert.equal(tall.length, 1);
  assert.match(tall[0].message, /cut off screen/);
});

test('G3: fraction entries make a worked example taller ("Order of a Matrix": its 4 steps fit only in two columns)', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes, checkSlideData } = await import('../src/slides.js');
  const build = await buildTemplates();
  const T = slideTypes(build).mathematics;
  const fit = (d) => build.registry['mathematics/worked-example'].check(d, { fit: true });
  // As in the stored video: each step works out both entries of a row.
  const step = (r) => ({ text: `Substitute indices for row ${r} of the matrix.`, formula: String.raw`a_{${r}1}=\dfrac{1}{2}|${r}-3(1)|=\dfrac{1}{2},\quad a_{${r}2}=\dfrac{1}{2}|${r}-3(2)|=\dfrac{3}{2}` });
  const d = {
    title: 'Construct a Matrix from Entries',
    problem: String.raw`Construct a $3\times 2$ matrix whose elements are given by $a_{ij}=\dfrac{1}{2}|i-3j|$.`,
    steps: [{ text: 'Write the entry positions.', formula: String.raw`A=\begin{bmatrix}a_{11}&a_{12}\\a_{21}&a_{22}\\a_{31}&a_{32}\end{bmatrix}` }, step(1), step(2), step(3)],
    answer: String.raw`The required matrix is $A=\begin{bmatrix}1&\dfrac{5}{2}\\\dfrac{1}{2}&2\\0&\dfrac{3}{2}\end{bmatrix}$.`,
    tip: 'Use $i$ for the row and $j$ for the column.',
  };
  const errors = (x) => checkSlideData(T.solved_example, x, { where: 's05' }).issues.filter((i) => i.code === 'TEMPLATE_CHECK');
  assert.deepEqual(errors(d), []);
  assert.equal(fit(d).columns, 2);
  assert.ok(fit(d).answer > 280, `a 3-row matrix of \\dfrac entries is ~5 lines tall (estimated ${fit(d).answer}px, measured 308px)`);
  assert.equal(errors({ ...d, steps: [...d.steps, step(4), step(5)] }).length, 1, 'two more fraction steps no longer fit');
});

test('V1: text cut off by more than a few px is an error, padding-sized overflow a warning', async () => {
  const { gateVideo } = await import('../src/validators/media.js');
  const probe = { streams: [{ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1' }, { codec_type: 'audio' }], format: { duration: '10' } };
  const issues = gateVideo(probe, { duration: 10, fps: 25, width: 1920, height: 1080 }, {
    layout: [{ where: 's05', what: 'text clipped in .card (40px cut off): SOLUTION…', px: 40 }, { where: 's06', what: 'text clipped in .card (4px cut off)', px: 4 }],
  });
  assert.deepEqual(issues.map((i) => [i.code, i.severity, i.path]), [['TEXT_CLIPPED', 'error', 's05'], ['LAYOUT_OVERFLOW', 'warning', 's06']]);
});
