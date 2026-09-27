import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, merge } from '../src/config.js';
import { checkContract, gateReport } from '../src/contracts/index.js';
import { buildTemplates, lookup, templateDirs } from '../src/templates.js';

test('config: defaults load and local overrides merge key by key', () => {
  const cfg = loadConfig();
  assert.equal(cfg.video.fps, 25);
  assert.equal(cfg.curriculum.lectures_per_chapter, 5);
  assert.equal(cfg.language.voice, 'hinglish');
  const m = merge(cfg, { tts: { provider: 'google' }, video: { jobs: 8 } });
  assert.equal(m.tts.provider, 'google');
  assert.equal(m.tts.sarvam.pace, 0.9, 'sibling keys survive');
  assert.equal(m.video.fps, 25);
});

const chapter = {
  chapter_id: 'bio-11-08', class: 11, subject: 'Biology', pack: 'biology', variant: null,
  title: 'Cell: The Unit of Life', source_text: 'x'.repeat(300),
  images: [{ id: 'img_1', url: 'https://res.cloudinary.com/demo/cell.webp', description: 'Plant cell diagram' }],
};

test('contracts: a valid chapter input passes', () => {
  assert.deepEqual(checkContract('chapter-input', chapter), []);
});

test('contracts: bad pack, class and unknown keys are reported', () => {
  const issues = checkContract('chapter-input', { ...chapter, pack: 'zoology', class: 5, extra: 1 });
  const text = issues.map((i) => i.message).join('\n');
  assert.match(text, /\/pack/);
  assert.match(text, /\/class/);
  assert.match(text, /"extra"/);
  assert.ok(issues.every((i) => i.code === 'SCHEMA' && i.severity === 'error'));
});

test('gateReport: status follows the worst issue', () => {
  assert.equal(gateReport('G-1', 'ch', []).status, 'pass');
  assert.equal(gateReport('G-1', 'ch', [{ code: 'X', severity: 'warning', message: '' }]).status, 'warn');
  assert.equal(gateReport('G-1', 'ch', [{ code: 'X', severity: 'error', message: '' }]).status, 'fail');
});

test('templates: biology pack is discovered and legacy ids still resolve', async () => {
  assert.ok(templateDirs().includes('biology/definition'));
  const build = await buildTemplates();
  assert.equal(lookup(build, 'bio-02').id, 'biology/definition');
  assert.equal(lookup(build, 'bio-02-definition-table').id, 'biology/definition');
  assert.equal(lookup(build, 'bio-12').id, 'biology/mcq');
  assert.match(build.css, /\[data-template="biology\/definition"\]/, 'styles are scoped by the full pack id');
});
