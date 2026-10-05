// English and Hindi are taught as languages, in their own language: the
// language pack, per-course narration language, its script gates and voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge } from '../src/config.js';
import { buildTemplates } from '../src/templates.js';
import { slideTypes, checkSlideData } from '../src/slides.js';
import { narrationLanguageOf } from '../src/curriculum/index.js';
import { hindiScript, englishScript } from '../src/validators/generation.js';
import { voiceConfig } from '../src/sound/index.js';
import { narrationLanguage, needsConversion } from '../src/generation/layers/narrate.js';
import { runLectureJob } from '../src/pipeline/run.js';

const cfg = merge(loadConfig(), { llm: { provider: 'mock' }, tts: { provider: 'mock', cache: false } });
const T = slideTypes(await buildTemplates()).language;
const codes = (issues) => issues.filter((i) => i.severity === 'error').map((i) => i.code);

test('Hindi courses are narrated in Hindi, English courses in English, the rest in Hinglish', () => {
  assert.equal(narrationLanguageOf({ subject: 'Hindi' }), 'hindi');
  assert.equal(narrationLanguageOf({ subject: 'English' }), 'english');
  assert.equal(narrationLanguageOf({ subject: 'Physics' }), 'hinglish');
  assert.equal(narrationLanguageOf({ subject: 'History', narration_language: 'english' }), 'english');
  assert.equal(narrationLanguage(cfg, { narration_language: 'hindi' }), 'hindi');
  const via = merge(cfg, { narration: { mode: 'via-english' } });
  assert.equal(needsConversion(via, { narration_language: 'hinglish' }), true);
  assert.equal(needsConversion(via, { narration_language: 'hindi' }), false, 'a Hindi lesson is never drafted in English first');
});

test('Hindi narration: Devanagari throughout, not Hinglish', () => {
  assert.deepEqual(codes(hindiScript('कबीर कहते हैं कि मन एक मानसरोवर की तरह है, जो भक्ति के निर्मल जल से भरा हुआ है।')), []);
  assert.ok(codes(hindiScript('कबीर का यह concept बहुत important है because यह mind की purity को explain करता है।')).includes('NOT_HINDI'));
  assert.ok(codes(hindiScript('Kabir kehte hain ki mann ek sarovar hai aur yeh bahut sundar hai।')).includes('ROMANIZED_HINDI'));
});

test('English narration: English only', () => {
  assert.deepEqual(codes(englishScript('The poet says that desire, like fire, can destroy the world.')), []);
  assert.ok(codes(englishScript('The poet says ki desire बहुत strong है.')).includes('NOT_ENGLISH'));
});

test('slides show their fixed labels in the slide language', () => {
  const data = { title: 'साखी', lines: [{ text: 'मानसरोवर सुभर जल, हंसा केलि कराहिं।', meaning: 'मन भक्ति के जल से भरा है।' }] };
  const hi = checkSlideData(T.passage, data, { slideLanguage: 'hindi' });
  assert.equal(hi.data.meaningLabel, 'अर्थ');
  assert.deepEqual(codes(hi.issues), []);
  assert.equal(checkSlideData(T.passage, { ...data, title: 'Lines' }).data.meaningLabel, undefined, 'English slides keep the template default');
});

test('voice settings follow the narration language', () => {
  const c = merge(loadConfig(), {});
  assert.equal(voiceConfig(c, 'english').tts.google.language, 'en-IN');
  assert.match(voiceConfig(c, 'hindi').tts.google.prompt, /Hindi teacher/);
  assert.equal(voiceConfig(c, 'hindi').tts.google.voice, c.tts.google.voice, 'the same voice, steered for the language');
  assert.equal(voiceConfig(c, 'hinglish'), c);
});

const SENT = 'कबीर कहते हैं कि सच्चा प्रेम और भक्ति मन को निर्मल बना देते हैं, और जो व्यक्ति अपने भीतर ईश्वर को खोजता है वही सच्चा ज्ञानी है।';
test('a Hindi lesson (mock): language pack, Hindi narration, Hindi labels, sky-theme project', { timeout: 600000 }, async () => {
  const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'hvr-lang-'));
  const input = {
    lecture_id: 8801, module_id: 880, course_id: 125, class: 9, subject: 'Hindi', pack: 'language', variant: 'hindi',
    slide_language: 'hindi', narration_language: 'hindi',
    chapter_title: 'साखियाँ एवं सबद', chapter_number: 9, course_title: 'क्षितिज', title: 'साखियाँ', title_from_db: true,
    chapter_lectures: ['साखियाँ'], position: { index: 1, count: 1 }, format: 'doc',
    blocks: [1, 2, 3].flatMap((h) => [{ kind: 'heading', text: `साखी ${h}` }, { kind: 'text', text: Array(10).fill(SENT).join(' ') }]),
    keywords: [], summary: null,
  };
  const logs = [];
  const r = await runLectureJob(input, { cfg: merge(cfg, { paths: { jobs } }), to: 'build', offline: true, log: (l) => logs.push(l) });
  const dir = path.join(jobs, 'c125', 'm880', 'l8801');
  assert.ok(fs.existsSync(path.join(dir, 'project.json')), `${r.status}\n${logs.join('\n')}`);
  const content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8'));
  assert.equal(content.narration_language, 'hindi');
  assert.equal(content.slides[0].data.chapterWord, 'पाठ');
  for (const s of content.slides.slice(1)) assert.deepEqual(codes(hindiScript(s.narration.hinglish)), [], `slide ${s.slide_number}: ${s.narration.hinglish.slice(0, 80)}`);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  assert.equal(project.theme, 'sky', 'lecture videos keep the sky-blue theme');
  assert.ok(project.scenes.every((s) => s.template.startsWith('language/')));
  fs.rmSync(jobs, { recursive: true, force: true });
});
