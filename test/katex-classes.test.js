import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';
import 'katex/contrib/mhchem';

// Template CSS is scoped only to its scene, so a rule on a class KaTeX also uses
// reaches inside every formula: theory/hook's `.text { position: absolute; top: 235px }`
// threw the "m" of `$300\ \text{m}^2$` out of its line, mid-slide (Class 10 Maths Ch 4 L1).
const SAMPLES = [
  String.raw`x^2_1`, String.raw`\frac{a}{b}`, String.raw`\dfrac{a}{b}`, String.raw`\sqrt[3]{x}`, String.raw`\vec{E}`,
  String.raw`\hat{n}`, String.raw`\bar{x}`, String.raw`\overline{AB}`, String.raw`\underline{x}`, String.raw`300\ \text{m}^2`,
  String.raw`\mathrm{m}`, String.raw`\textbf{a}`, String.raw`\mathbf{a}`, String.raw`\boldsymbol{\alpha}`,
  String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`, String.raw`\begin{cases}a&b\end{cases}`, String.raw`\begin{aligned}a&=b\end{aligned}`,
  String.raw`\begin{array}{c|c}a&b\\\hline c&d\end{array}`, String.raw`\sum_{i=1}^n`, String.raw`\int_0^1`, String.raw`\lim_{x\to0}`,
  String.raw`\left(\frac{a}{b}\right)`, String.raw`\overbrace{x}^{n}`, String.raw`\underbrace{x}_{n}`, String.raw`\xrightarrow{a}`,
  String.raw`\cancel{x}`, String.raw`\boxed{x}`, String.raw`\fbox{x}`, String.raw`\ce{H2O ->[heat] H2 + O2}`, String.raw`\ce{SO4^2-}`,
  String.raw`\stackrel{a}{=}`, String.raw`\binom{n}{k}`, String.raw`a\,b\;c\quad d`, String.raw`\angle ABC`, String.raw`\overset{a}{b}`,
  String.raw`\pmod{n}`, String.raw`\operatorname{f}`, String.raw`\tag{1}`, String.raw`\not=`, String.raw`\colorbox{red}{x}`,
  String.raw`\phantom{x}`, String.raw`\mathcal{F}`, String.raw`\mathbb{R}`,
];

test('template CSS never styles a class KaTeX uses inside formulas', () => {
  const katexClasses = new Set();
  for (const s of SAMPLES) for (const displayMode of [false, true]) {
    const html = katex.renderToString(s, { throwOnError: false, displayMode, output: 'html' });
    for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) katexClasses.add(c);
  }
  assert.ok(katexClasses.has('text'), 'KaTeX draws \\text{…} as class "text"');
  const clashes = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.css')) {
        const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          if (katexClasses.has(m[1]) && !m[1].startsWith('katex')) clashes.push(`${path.relative('templates', p)}: .${m[1]}`);
        }
      }
    }
  };
  walk('templates');
  assert.deepEqual([...new Set(clashes)], [], 'rename these template classes: KaTeX uses them inside formulas');
});
