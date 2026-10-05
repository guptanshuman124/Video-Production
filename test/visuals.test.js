// The visual layer: illustration pictures (generated + vision-checked, never
// trusted blind), code-drawn process diagrams, sharpened NCERT figures and
// the new slide types.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, merge } from '../src/config.js';
import { buildTemplates } from '../src/templates.js';
import { slideTypes, checkSlideData } from '../src/slides.js';
import { makeWav } from '../src/sound/wav.js';
import { buildProject } from '../src/build/project.js';
import { enhanceFigure } from '../src/build/images.js';
import { imageSize } from '../src/generation/prepare.js';
import { FFMPEG } from '../src/tools.js';

const cfg = merge(loadConfig(), { tts: { provider: 'mock', cache: false } });
const ALL = slideTypes(await buildTemplates());
const T = ALL.biology;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test('every pack offers illustration and process_flow', () => {
  for (const pack of ['biology', 'chemistry', 'physics', 'mathematics', 'theory', 'commerce', 'language']) {
    assert.ok(ALL[pack].illustration, `${pack}: illustration`);
    assert.ok(ALL[pack].process_flow, `${pack}: process_flow`);
  }
});

test('illustration: art_prompt may only describe a plain scene', () => {
  const ok = checkSlideData(T.illustration, { title: 'Rust', art_prompt: 'An old iron gate with rust patches after rain, close-up, soft light', points: ['Iron reacts with air and water', 'The coating is rust'] });
  assert.deepEqual(ok.issues.filter((i) => i.severity === 'error'), []);
  for (const bad of ['A labelled diagram of the human heart', 'A map of India with rivers', 'A poster with the words SAVE WATER', 'A cross-section of a leaf']) {
    const r = checkSlideData(T.illustration, { title: 'X', art_prompt: bad, points: ['a b c', 'd e f'] });
    assert.ok(r.issues.some((i) => i.code === 'TEMPLATE_CHECK'), `refused: ${bad}`);
  }
});

test('process_flow: 3–6 steps; a cycle needs 3', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1}`, detail: 'what happens here' }));
  assert.deepEqual(checkSlideData(T.process_flow, { title: 'Flow', steps: steps(4) }).issues.filter((i) => i.severity === 'error'), []);
  assert.ok(checkSlideData(T.process_flow, { title: 'Flow', steps: steps(2) }).issues.some((i) => i.code === 'ITEM_COUNT'));
  assert.ok(checkSlideData(T.process_flow, { title: 'Flow', steps: steps(7) }).issues.some((i) => i.severity === 'error'));
});

// A fake OpenAI client: images.generate returns a tiny PNG; the vision check
// returns the verdicts given, in order.
function fakeClient(verdicts) {
  const calls = { generate: 0, check: 0 };
  return {
    calls,
    images: { generate: async () => { calls.generate++; return { data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 100, output_tokens: 1000 } }; } },
    responses: { create: async () => { const v = verdicts[Math.min(calls.check, verdicts.length - 1)]; calls.check++; return { output_text: JSON.stringify(v), usage: { input_tokens: 900, output_tokens: 40 } }; } },
  };
}
const GOOD = { has_text: false, matches_prompt: true, misleading: false, suitable: true, problems: '' };
const TEXT = { has_text: true, matches_prompt: true, misleading: false, suitable: true, problems: 'a sign with letters in the background' };

async function buildWithArt(client, prompt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-art-'));
  const content = {
    chapter_id: 'c', lecture: 1, class: 10, subject: 'Science', title: 'Test',
    slides: [{ slide_number: 1, slide_type: 'illustration', title: 'Rust', data: { title: 'Rust', art_prompt: prompt, points: ['Iron reacts with air and water', 'The coating is rust'] }, image: null }],
  };
  fs.mkdirSync(path.join(dir, 'voice'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'voice/s01.wav'), makeWav(Buffer.alloc(44100 * 2 * 6)));
  const voice = { provider: 'mock', slides: [{ slide_number: 1, clip: 'voice/s01.wav', duration: 6, markers: { 'b1.1': 1, 'b1.2': 3 } }] };
  const r = await buildProject(content, voice, T, cfg, { dir, art: { enabled: true, cacheDir: path.join(dir, 'cache'), logFile: path.join(dir, 'llm.jsonl'), client } });
  return { dir, ...r };
}

test('art: a picture that passes the vision check is attached and logged with its cost', async () => {
  const client = fakeClient([GOOD]);
  const { dir, project, issues } = await buildWithArt(client, 'An old iron gate with rust patches after rain');
  assert.equal(project.scenes[0].data.art, 'assets/art-s01.jpg');
  assert.ok(fs.existsSync(path.join(dir, 'assets/art-s01.jpg')));
  assert.deepEqual(issues, []);
  const rows = fs.readFileSync(path.join(dir, 'llm.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.some((r) => r.task === 'art' && r.usage.cost_usd > 0) && rows.some((r) => r.task === 'art-check'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('art: a picture with visible text is redrawn, then dropped for the text-only layout', async () => {
  const client = fakeClient([TEXT, TEXT]);
  const { dir, project, issues } = await buildWithArt(client, 'A busy street market at dusk');
  assert.equal(client.calls.generate, 2, 'one redraw');
  assert.equal(project.scenes[0].data.art, undefined);
  assert.ok(issues.some((i) => i.code === 'ART_REJECTED' && i.severity === 'warning'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('art: off in a run → text-only layout with a warning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-art-'));
  fs.mkdirSync(path.join(dir, 'voice'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'voice/s01.wav'), makeWav(Buffer.alloc(44100 * 2 * 4)));
  const content = { chapter_id: 'c', lecture: 1, class: 10, subject: 'Science', title: 'T',
    slides: [{ slide_number: 1, slide_type: 'illustration', title: 'R', data: { title: 'R', art_prompt: 'A garden', points: ['a b', 'c d'] }, image: null }] };
  const voice = { provider: 'mock', slides: [{ slide_number: 1, clip: 'voice/s01.wav', duration: 4, markers: {} }] };
  const { issues } = await buildProject(content, voice, T, cfg, { dir });
  assert.ok(issues.some((i) => i.code === 'ART_SKIPPED'));
  fs.rmSync(dir, { recursive: true, force: true });
});

const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
test('NCERT figures: every one is enhanced — small ones enlarged and sharpened, large ones sharpened at their size', { skip: !hasFfmpeg && 'ffmpeg not available' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-img-'));
  const small = path.join(dir, 'small.png'), big = path.join(dir, 'big.jpg'), bad = path.join(dir, 'bad.png');
  spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=400x300', '-frames:v', '1', small]);
  spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=2400x1600', '-frames:v', '1', big]);
  fs.writeFileSync(bad, 'not an image');
  const hd = enhanceFigure(small, { target: 2000, max_scale: 3 });
  assert.ok(hd && hd.endsWith('.hd2.png'));
  assert.deepEqual(imageSize(fs.readFileSync(hd)), { width: 1200, height: 900 });   // capped at 3×
  const large = enhanceFigure(big);
  assert.ok(large, 'a large JPEG is still denoised and sharpened');
  assert.deepEqual(imageSize(fs.readFileSync(large)), { width: 2400, height: 1600 });
  assert.equal(enhanceFigure(bad), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

