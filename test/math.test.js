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

test('G3: the fit check sizes the slide with the figure the plan gives it (lecture 2736 failed at build instead)', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes } = await import('../src/slides.js');
  const { gateSlides } = await import('../src/validators/generation.js');
  const T = slideTypes(await buildTemplates()).mathematics;
  const M = String.raw`\begin{bmatrix}4&4&4&-7\\35&-2&-39&22\\31&2&-27&11\end{bmatrix}`;
  const data = {
    title: 'Verify Associativity',
    problem: String.raw`If $A=\begin{bmatrix}1&1&-1\\2&0&3\\3&-1&2\end{bmatrix}$ and $B=\begin{bmatrix}1&3\\0&2\\-1&4\end{bmatrix}$, show that $(AB)C=A(BC)$.`,
    steps: Array.from({ length: 4 }, (_, i) => ({ text: `Step ${i + 1}: multiply.`, formula: `X_${i}=${M}` })),
    answer: `Thus, $(AB)C=A(BC)=${M}$.`,
  };
  const plan = (image_id) => [{ slide_type: 'solved_example', source_refs: [], ...(image_id ? { image_id } : {}) }];
  const checks = (image_id) => gateSlides([{ slide_type: 'solved_example', data }], plan(image_id), T, {}).issues.filter((i) => i.code === 'TEMPLATE_CHECK');
  assert.deepEqual(checks(null), [], 'without a figure it fits in two columns');
  const withFig = checks('fig_13_1');
  assert.equal(withFig.length, 1, 'beside a figure the card is narrow and one column: back to the writer at G3');
  assert.match(withFig[0].message, /beside its figure/);
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

// Lecture "Applications of Gauss's Law" (Class 12 Physics Ch 1): the symbol key ran out of its box
// and the derivation steps out of theirs and off the slide.
const gauss = {
  sheet: {
    lecture: 'Applications of Gauss’s Law', title: 'Three Symmetries, Four Field Results',
    items: [
      { formula: String.raw`\vec{E} = \frac{\lambda}{2\pi\varepsilon_0 r}\hat{n}`, label: 'Wire: cylindrical surface' },
      { formula: String.raw`\vec{E} = \frac{\sigma}{2\varepsilon_0}\hat{n}`, label: 'Sheet: two faces' },
      { formula: String.raw`\vec{E} = \frac{q}{4\pi\varepsilon_0 r^2}\hat{r} \quad (r > R)`, label: 'Shell: outside' },
      { formula: String.raw`\vec{E} = 0 \quad (r < R)`, label: 'Shell: inside' },
    ],
    symbols: [
      [String.raw`\vec{E}`, 'electric field (N $C^{-1}$)'], [String.raw`\lambda`, 'linear charge density (C $m^{-1}$)'],
      [String.raw`\sigma`, 'surface charge density (C $m^{-2}$)'], ['q', 'shell charge (C)'], ['r', 'radial distance (m)'],
      ['R', 'shell radius (m)'], [String.raw`\hat{n}`, 'outward normal (unitless)'], [String.raw`\hat{r}`, 'radial unit vector (unitless)'],
    ].map(([symbol, meaning]) => ({ symbol, meaning })),
  },
  wire: {
    lecture: 'Applications of Gauss’s Law', title: 'Field of an Infinite Wire',
    goal: String.raw`\vec{E} = \frac{\lambda}{2\pi\varepsilon_0 r}\hat{n}`,
    steps: [
      { text: 'By **symmetry**, the field is radial and depends only on $r$.', formula: String.raw`\vec{E} = E(r)\hat{n}` },
      { text: 'End flux vanishes; curved-surface flux equals field times area.', formula: String.raw`\Phi = E(2\pi r l)` },
      { text: 'Substitute enclosed charge $\lambda l$ into Gauss’s law.', formula: String.raw`E(2\pi r l) = \frac{\lambda l}{\varepsilon_0}` },
      { text: 'Cancel $l$ and express the radial field vector.', formula: String.raw`\vec{E} = \frac{\lambda}{2\pi\varepsilon_0 r}\hat{n}` },
    ],
  },
};

test('G3: a symbol key taller than its box goes back to the writer; with 4 formulas it gets the whole column', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const t = (await buildTemplates()).registry['physics/formula-sheet'];
  const d = structuredClone(gauss.sheet);
  assert.deepEqual(t.check(d), []);
  assert.equal(t.check(d, { fit: true }).room, 730, 'rows 1–4 of the right column');
  const six = { ...d, items: [...d.items, ...d.items.slice(0, 2)] };
  assert.equal(t.check(six, { fit: true }).room, 360, 'tiles 5–6 take the bottom of the right column');
  assert.deepEqual(t.check(six), [], 'short meanings: the stage shrinks the key a little and it fits');
  const long = { ...six, symbols: six.symbols.map((s) => ({ ...s, meaning: `${s.meaning} measured along the closed gaussian surface` })) };
  assert.match(String(t.check(long)), /symbol key needs ~\d+px but has 360px.*cut off screen/);
});

test('G3: derivation steps taller than their share go back to the writer; without an image text and equation share a row', async () => {
  const { buildTemplates } = await import('../src/templates.js');
  const t = (await buildTemplates()).registry['physics/derivation'];
  const d = structuredClone(gauss.wire);
  assert.deepEqual(t.check(d), []);
  const fit = t.check(d, { fit: true });
  assert.equal(fit.share, 123);
  assert.ok(fit.ratio < 1, `fits beside each other: ${JSON.stringify(fit)}`);
  // a fraction inside a fraction is taller than one fraction
  const nested = { ...d, steps: d.steps.map((s) => ({ ...s, formula: String.raw`\dfrac{\vec{E}}{\dfrac{a}{b}}` })) };
  assert.ok(t.check(nested, { fit: true }).need[0] > fit.need[3]);
  const tall = { ...d, steps: d.steps.map((s) => ({ ...s, formula: String.raw`\dfrac{\dfrac{\dfrac{a}{b}}{c}}{\dfrac{d}{e}}` })) };
  assert.match(String(t.check(tall)), /step S1 needs ~\d+px but each step has 123px.*cut off screen/);
  assert.deepEqual((await buildTemplates()).registry['chemistry/derivation'].check(tall).length, 1, 'chemistry uses the same template');
});

test('V1: a box its content runs out of (not clipped) is an error too', async () => {
  const { gateVideo } = await import('../src/validators/media.js');
  const probe = { streams: [{ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1' }, { codec_type: 'audio' }], format: { duration: '10' } };
  const issues = gateVideo(probe, { duration: 10, fps: 25, width: 1920, height: 1080 }, {
    layout: [{ where: 's07', what: 'text spills out of .symbols (47px outside it)', px: 47 }, { where: 's03', what: '.step runs 30px off the bottom of the slide', px: 30 }],
  });
  assert.deepEqual(issues.map((i) => [i.code, i.severity]), [['TEXT_CLIPPED', 'error'], ['TEXT_CLIPPED', 'error']]);
});
