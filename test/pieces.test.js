// Summary videos are rendered in pieces across workers (render.js piecePlan /
// renderPiece / joinPieces; summary/run.js; factory pieces). A real render of a
// short project: pieces out of order, one interrupted and redone, joined with
// the voice track — the same frames and length as the timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTemplates } from '../src/templates.js';
import { normalizeProject } from '../src/project.js';
import { piecePlan, renderPiece, joinPieces } from '../src/render.js';
import { FFMPEG, FFPROBE } from '../src/tools.js';

const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;

test('render in pieces: out of order, one interrupted, joined with audio = the whole timeline', { timeout: 900000, skip: !hasFfmpeg && 'ffmpeg not available' }, async () => {
  const build = await buildTemplates();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-pieces-'));
  spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=70', '-ar', '24000', '-ac', '1', path.join(dir, 'track.wav')]);
  const ids = ['summary/title', 'commerce/journal-entry', 'language/passage'];
  const scenes = ids.map((id) => ({ template: id, duration: 24000, data: structuredClone(build.registry[id].example), transition: { name: 'soft', duration: 700 } }));
  const project = await normalizeProject({ title: 't', fadeIn: 0, fadeOut: 0, theme: 'dark', audio: 'track.wav', scenes }, dir);
  const plan = await piecePlan(project, { pieceSeconds: 30 });
  assert.equal(plan.pieces.length, 3);
  assert.equal(plan.pieces.at(-1).to, plan.count);
  const opts = { jobs: 2, capture: 'jpeg', preset: 'veryfast', crf: 30 };
  const file = (i) => path.join(dir, `piece-${i}.mp4`);
  // Piece 2 first, then piece 0 is "killed" half-way and rendered again, then piece 1.
  await renderPiece(project, { ...opts, ...plan.pieces[2], out: file(2) });
  await assert.rejects(renderPiece(project, { ...opts, ...plan.pieces[0], out: file(0), onFrame: (d) => { if (d > 200) throw new Error('worker killed'); } }));
  await renderPiece(project, { ...opts, ...plan.pieces[0], out: file(0) });
  await renderPiece(project, { ...opts, ...plan.pieces[1], out: file(1) });
  const out = path.join(dir, 'summary.mp4');
  const probe = await joinPieces({ files: [0, 1, 2].map(file), out, audio: path.join(dir, 'track.wav') });
  assert.equal(Number(probe.streams[0].nb_frames), plan.count);
  assert.ok(Math.abs(Number(probe.format.duration) - plan.duration / 1000) < 0.2, `${probe.format.duration} vs ${plan.duration / 1000}`);
  const a = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  assert.equal(a.stdout.trim(), 'aac', 'the voice track is muxed once, at the join');
  fs.rmSync(dir, { recursive: true, force: true });
});
