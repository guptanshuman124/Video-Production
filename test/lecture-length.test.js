import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { gateAudio, lectureTarget } from '../src/validators/media.js';
import { validate, visibleLength } from '../src/templates.js';
import { tooLongTargets } from '../src/generation/shorten.js';

const cfg = loadConfig();
const plan = (teaching) => ({ slides: [{ slide_type: 'intro' }, ...Array.from({ length: teaching }, () => ({ slide_type: 'definition' }))] });
// Narration as measured on lecture 2847: ~1.9 min a slide, ~160 words a minute.
const voice = (teaching, secondsEach) => ({ slides: [{ slide_number: 1, duration: 10, words: 25 },
  ...Array.from({ length: teaching }, (_, i) => ({ slide_number: i + 2, duration: secondsEach, words: Math.round(secondsEach * 160 / 60) }))] });
const lengthErrors = (v, target) => gateAudio(v, cfg, { targetMinutes: target }).filter((i) => i.code === 'LECTURE_LENGTH' && i.severity === 'error');

test('A1: a short source planned with 7 teaching slides is held to what its slides take (lecture 2847)', () => {
  assert.equal(lectureTarget(8, plan(7), cfg), 12.9);
  assert.equal(lectureTarget(20, plan(8), cfg), 20, 'a long source keeps its own target');
  assert.equal(lectureTarget(null, plan(7), cfg), null);
  const v = voice(7, 112);                                  // 13.4 min of audio, as stored
  assert.equal(lengthErrors(v, 8).length, 1, 'against the 8-min source target it failed');
  assert.deepEqual(lengthErrors(v, lectureTarget(8, plan(7), cfg)), []);
  assert.equal(lengthErrors(voice(7, 20), lectureTarget(8, plan(7), cfg)).length, 1, 'truncated audio still fails');
});

test('slide text limits count what is shown; character-limit errors get the targeted shorten pass (lecture 5372)', () => {
  assert.equal(visibleLength('a *key* and **strong** word'), 'a key and strong word'.length);
  const schema = { points: { type: 'list', of: { type: 'text', max: 20 } } };
  assert.deepEqual(validate(schema, { points: ['*twenty chars long!*'] }).errors, [], '20 visible characters fit a 20 limit');
  assert.equal(validate(schema, { points: ['twenty-one characters'] }).errors.length, 1);
  const issues = [{ code: 'TEMPLATE_SCHEMA', severity: 'error', path: 's05', message: 's05.points[0]: longer than 120 chars' }];
  assert.deepEqual(tooLongTargets(issues, { points: ['x'.repeat(124)] }), [{ keys: ['points', 0], text: 'x'.repeat(124), maxChars: 120 }]);
});
