import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTemplates, loadPacks, baseTemplateOf } from '../src/templates.js';
import { slideTypes, checkSlideData, requiredMarkers, markersIn } from '../src/slides.js';

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

test('prompt examples pass their slide type checks, with narration markers in order', () => {
  for (const id of Object.keys(packs)) {
    const dir = path.join('prompts', 'packs', id, 'examples');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const type = f.replace(/\.json$/, '');
      const st = T[id][type];
      assert.ok(st, `${id}/examples/${f}: no slide type "${type}"`);
      const ex = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const r = checkSlideData(st, st.spec.codeOnly ? { title: 'Intro' } : ex.data, { where: `${id}/${type}` });
      assert.deepEqual(r.issues.filter((i) => i.severity === 'error'), [], `${id}/examples/${f}`);
      for (const key of ['narration', 'narration_hinglish']) {
        if (!ex[key]) continue;
        assert.deepEqual(markersIn(ex[key]), requiredMarkers(st.spec, r.data), `${id}/examples/${f} ${key}: markers`);
      }
    }
  }
});

test('mathematics + theory + commerce template examples validate against their own slide spec', () => {
  let checked = 0;
  for (const id of ['mathematics', 'theory', 'commerce']) {
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
