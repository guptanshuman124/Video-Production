// End to end with the mock LLM and mock TTS, up to the render project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge } from '../src/config.js';
import { runChapter } from '../src/pipeline/run.js';
import { checkContract } from '../src/contracts/index.js';

const sample = JSON.parse(fs.readFileSync(new URL('../examples/chapter-input.sample.json', import.meta.url), 'utf8'));
// Offline: give every image a size so prepare needs no network.
const chapter = { ...sample, chapter_id: 'test-chapter', images: sample.images.map((im, i) => ({ ...im, width: 1024, height: i % 2 ? 1536 : 1024 })) };

test('pipeline (mock): chapter -> 5 validated lectures -> content + voice + project', { timeout: 600000 }, async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-jobs-'));
  const cfg = merge(loadConfig(), { llm: { provider: 'mock' }, tts: { provider: 'mock' }, paths: { jobs } });
  const logs = [];
  const summary = await runChapter(chapter, { cfg, to: 'build', offline: true, log: (l) => logs.push(l) });
  assert.deepEqual(summary.lectures, { 1: 'ok', 2: 'ok', 3: 'ok', 4: 'ok', 5: 'ok' }, logs.join('\n'));
  assert.equal(summary.reviewQueue, 0);
  const dir = path.join(jobs, 'test-chapter');
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'L1/content.json'), 'utf8'));
  assert.deepEqual(checkContract('content-v1', content), []);
  assert.equal(content.slides[0].slide_type, 'chapter_index');
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'L1/project.json'), 'utf8'));
  assert.equal(project.scenes.length, content.slides.length);
  assert.ok(fs.existsSync(path.join(dir, 'L1/voice/track.wav')));

  // Resume: a second run reuses every stage.
  const again = [];
  await runChapter(chapter, { cfg, to: 'build', offline: true, log: (l) => again.push(l) });
  assert.equal(again.filter((l) => /[✓!✗] /.test(l)).length, 0, 'nothing re-ran');

  // --from narrate re-runs narration and downstream only, for lecture 2.
  const redo = [];
  await runChapter(chapter, { cfg, to: 'build', offline: true, from: 'narrate', lectures: [2], log: (l) => redo.push(l) });
  const ran = redo.filter((l) => /[✓!✗] /.test(l)).map((l) => l.trim().split(/\s+/).slice(1, 3).join(' '));
  // direct mode: narration is Hinglish from the start — no separate hinglish stage.
  assert.deepEqual(ran, ['L2 narrate', 'L2 review', 'L2 assemble', 'L2 voice', 'L2 build']);
  assert.ok(!fs.existsSync(path.join(dir, 'L2/narration-en.json')));
  fs.rmSync(jobs, { recursive: true, force: true });
});

test('pipeline: a bad input stops at G0 with the reason recorded', async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-jobs-'));
  const cfg = merge(loadConfig(), { llm: { provider: 'mock' }, tts: { provider: 'mock' }, paths: { jobs } });
  const summary = await runChapter({ ...chapter, chapter_id: 'bad', pack: 'mathematics' }, { cfg, to: 'build', offline: true, log: () => {} });
  assert.match(summary.stoppedAt, /prepare failed G0/);
  const q = JSON.parse(fs.readFileSync(path.join(jobs, 'bad', 'review-queue.json'), 'utf8'));
  assert.equal(q[0].errors[0].code, 'PACK_NOT_INSTALLED');
  fs.rmSync(jobs, { recursive: true, force: true });
});
