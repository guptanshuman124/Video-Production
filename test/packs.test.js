import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTemplates, loadPacks, baseTemplateOf } from '../src/templates.js';
import { slideTypes, checkSlideData, requiredMarkers, markersIn } from '../src/slides.js';
import { hindiScript, englishScript } from '../src/validators/generation.js';

const build = await buildTemplates();
const T = slideTypes(build);
const packs = loadPacks();

test('every pack type in pack.json has a template, and every fallback exists', () => {
  for (const [id, p] of Object.entries(packs)) {
    for (const t of Object.keys(p.types || {})) assert.ok(T[id][t], `${id}: pack.json lists "${t}" but no template provides it`);
    for (const [from, to] of Object.entries(p.fallbacks || {})) assert.ok(T[id][from] && T[id][to], `${id}: fallback ${from} → ${to}`);
    for (const t of p.flow?.firstLecture?.opening || []) assert.ok(T[id][t], `${id}: opening type ${t}`);
  }
});

// Each pack's examples, plus each variant's own (prompts/packs/<pack>/variants/<v>/examples).
function exampleDirs(id) {
  const root = path.join('prompts', 'packs', id);
  const out = [{ dir: path.join(root, 'examples'), variant: null }];
  const vdir = path.join(root, 'variants');
  if (fs.existsSync(vdir)) for (const v of fs.readdirSync(vdir)) out.push({ dir: path.join(vdir, v, 'examples'), variant: v });
  return out.filter((x) => fs.existsSync(x.dir));
}

test('prompt examples pass their slide type checks, with narration markers in order', () => {
  for (const id of Object.keys(packs)) {
    for (const { dir, variant } of exampleDirs(id)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        const type = f.replace(/\.json$/, '');
        const st = T[id][type];
        assert.ok(st, `${dir}/${f}: no slide type "${type}"`);
        const ex = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const slideLanguage = variant === 'hindi' ? 'hindi' : 'english';
        const r = checkSlideData(st, st.spec.codeOnly ? { title: 'Intro' } : ex.data, { where: `${id}/${type}`, slideLanguage });
        assert.deepEqual(r.issues.filter((i) => i.severity === 'error'), [], `${dir}/${f}`);
        for (const key of ['narration', 'narration_hinglish', 'narration_hindi']) {
          if (!ex[key]) continue;
          assert.deepEqual(markersIn(ex[key]), requiredMarkers(st.spec, r.data), `${dir}/${f} ${key}: markers`);
        }
        // The language courses' examples are in the voice-over's own language.
        if (ex.narration_hindi) assert.deepEqual(hindiScript(ex.narration_hindi).filter((i) => i.severity === 'error'), [], `${dir}/${f}: Hindi narration`);
        if (id === 'language' && ex.narration) assert.deepEqual(englishScript(ex.narration).filter((i) => i.severity === 'error'), [], `${dir}/${f}: English narration`);
      }
    }
  }
});

test('mathematics, theory, commerce and language template examples validate against their own slide spec', () => {
  let checked = 0;
  for (const id of ['mathematics', 'theory', 'commerce', 'language']) {
    for (const st of Object.values(T[id])) {
      const f = path.join('templates', st.templateId, 'example.json');
      if (!fs.existsSync(f) || st.spec.codeOnly || baseTemplateOf(st.templateId)) continue;   // the new templates (wrappers are checked in their own pack)
      const data = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(f, 'utf8'))).filter(([k]) => k !== 'lecture'));
      checked++;
      const r = checkSlideData(st, data, { where: st.templateId });
      assert.deepEqual(r.issues.filter((i) => i.severity === 'error' && i.code !== 'UNKNOWN_FIELD' && !(i.code === 'MISSING_FIELD' && i.path.endsWith('.title'))), [], st.templateId);
    }
  }
  assert.ok(checked >= 11, `only ${checked} examples checked`);
});
