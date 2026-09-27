import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge } from '../src/config.js';
import { buildTemplates } from '../src/templates.js';
import { slideTypes, applyCues } from '../src/slides.js';
import { createVoice, splitSegments } from '../src/sound/index.js';
import { speakable, splitForEngine } from '../src/sound/spoken.js';
import { makeWav, readWav, join, duration } from '../src/sound/wav.js';
import { buildProject } from '../src/build/project.js';
import { gateSync } from '../src/validators/media.js';
import { cleanText, sectionize, ratioBucket, imageSize, fitsRatio } from '../src/generation/prepare.js';

const cfg = merge(loadConfig(), { tts: { provider: 'mock', cache: false } });
const T = slideTypes(await buildTemplates()).biology;

test('segments: narration splits at markers, intro kept', () => {
  assert.deepEqual(splitSegments('Intro here. {{b1}} One. {{b2.1}} {{b2.2}} Two.'), [
    { marker: null, text: 'Intro here.' }, { marker: 'b1', text: 'One.' }, { marker: 'b2.1', text: '' }, { marker: 'b2.2', text: 'Two.' },
  ]);
  assert.deepEqual(splitSegments('{{b1}} Straight in.'), [{ marker: 'b1', text: 'Straight in.' }]);
});

test('wav: join is sample-exact', () => {
  const a = makeWav(Buffer.alloc(44100 * 2));           // 1.0 s
  const b = makeWav(Buffer.alloc(22050 * 2));           // 0.5 s
  const j = join([a, b, a], 200);
  assert.deepEqual(j.starts, [0, 1.2, 1.9]);
  assert.equal(duration(j.wav), 2.9);
  assert.equal(readWav(j.wav).rate, 44100);
});

test('voice (segments): marker time = start of its segment', async () => {
  const voice = createVoice(cfg);
  const r = await voice.slide('Intro words here now. {{b1}} First reveal text. {{b2}} Second reveal text here.');
  assert.equal(r.strategy, 'segments');
  const [intro, one] = r.segments;
  assert.equal(r.markers.b1, Math.round((intro.duration + 0.2) * 1000) / 1000);
  assert.equal(r.markers.b2, Math.round((intro.duration + one.duration + 0.4) * 1000) / 1000);
});

test('voice (marks): provider marks are used when the engine returns them', async () => {
  const voice = createVoice(merge(cfg, { tts: { mock: { marks: true } } }));
  const r = await voice.slide('Intro words. {{b1}} First reveal. {{b2}} Second.');
  assert.equal(r.strategy, 'marks');
  assert.ok(r.markers.b1 > 0 && r.markers.b2 > r.markers.b1);
});

test('spoken form: symbols and long numbers become words the engine reads', () => {
  assert.equal(speakable('H₂O at 100°C is 50% of 123456 units → steam'), 'H 2 O at 100 degree Celsius is 50 percent of 123,456 units to steam');
  const parts = splitForEngine('एक वाक्य है। '.repeat(200), 300);
  assert.ok(parts.every((p) => p.length <= 300) && parts.length > 1);
});

test('build: cues sit exactly reveal_lead before speech and pass the sync gate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-build-'));
  const content = {
    chapter_id: 'c', lecture: 1, class: 11, subject: 'Biology', title: 'Test',
    slides: [
      { slide_number: 1, slide_type: 'definition', title: 'A', data: { title: 'A', definition: 'Def.', points: ['p1', 'p2'] }, image: { id: 'img1', url: 'https://example.com/a.png', caption: 'cap' } },
      { slide_number: 2, slide_type: 'mcq', title: 'Q', data: { title: 'Q', question: 'Which?', options: ['a', 'b', 'c', 'd'], answer: 'B', wrong: ['C'], description: 'Because.' } },
    ],
  };
  fs.mkdirSync(path.join(dir, 'voice'), { recursive: true });
  const clip = makeWav(Buffer.alloc(44100 * 2 * 20));
  fs.writeFileSync(path.join(dir, 'voice/s01.wav'), clip);
  fs.writeFileSync(path.join(dir, 'voice/s02.wav'), clip);
  const voice = { provider: 'mock', slides: [
    { slide_number: 1, clip: 'voice/s01.wav', duration: 20, markers: { b1: 2, 'b2.1': 8, 'b2.2': 14 } },
    { slide_number: 2, clip: 'voice/s02.wav', duration: 20, markers: { b1: 10, b2: 15 } },
  ] };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const fetchImage = async (url, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png); };
  const { project, cues, required } = await buildProject(content, voice, T, cfg, { dir, fetchImage });
  const lead = cfg.timing.reveal_lead / 1000;
  for (const c of cues) assert.ok(Math.abs(c.audioAt - c.cueAt - lead) < 0.006, `${c.marker} drift`);
  assert.equal(project.scenes[0].data.cues.definition, cues[0].cueAt);
  assert.equal(project.scenes[1].data.cues.answer, cues.find((c) => c.scene === 1 && c.marker === 'b1').cueAt);
  assert.equal(project.scenes[0].data.image, 'assets/img1.png');
  assert.deepEqual(gateSync(project, cues, required, cfg).filter((i) => i.severity === 'error'), []);
  // A cue moved half a second is caught.
  const bad = cues.map((c, i) => (i === 1 ? { ...c, cueAt: c.cueAt + 0.5 } : c));
  assert.ok(gateSync(project, bad, required, cfg).some((i) => i.code === 'CUE_DRIFT'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cues: derived and paired cues', () => {
  const d = applyCues(T.definition.spec, { definition: 'x', columns: ['a', 'b'], rows: [['1', '2']] }, { b1: 1, 'b3.1': 5 }, (t) => 100 + t);
  assert.equal(d.cues.table, 104.4);
  const m = applyCues(T.misconception.spec, { rows: [{ myth: 'a', fact: 'b' }] }, { 'b1.1.1': 1, 'b1.1.2': 3 }, (t) => t);
  assert.deepEqual(m.cues.rows, [[1, 3]]);
});

test('prepare: headers, page numbers and hyphenation are cleaned; sections are numbered', () => {
  const raw = 'BIOLOGY\n8.1 What is a Cell?\nThe cell is the basic unit of life and cyto-\nplasm fills it.\n12\nBIOLOGY\n8.2 Cell Theory\nSchleiden and Schwann proposed it.\nBIOLOGY\n';
  const t = cleanText(raw);
  assert.ok(!/BIOLOGY/.test(t) && !/\n12\n/.test(t) && /cytoplasm/.test(t));
  const s = sectionize(t, { minSections: 2 });
  assert.equal(s[0].id, 's01');
  assert.match(s[0].heading, /8\.1 What is a Cell/);
});

test('images: ratio buckets, header parsing, slot fit', () => {
  assert.equal(ratioBucket(1024, 1536), '2:3');
  assert.equal(ratioBucket(1600, 1200), '4:3');
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { width: 640, height: 480 });
  assert.ok(fitsRatio({ width: 1024, height: 1536 }, ['3:4']));
  assert.ok(!fitsRatio({ width: 1600, height: 900 }, ['3:4', '1:1']));
});
