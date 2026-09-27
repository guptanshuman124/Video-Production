// Every schema sent to OpenAI must satisfy Structured Outputs strict mode:
// objects list all properties in `required` and set additionalProperties:
// false; only supported keywords are used. Caught here, not on the first
// paid call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplates } from '../src/templates.js';
import { slideTypes, llmSchema } from '../src/slides.js';
import { schemaOf } from '../src/contracts/index.js';

const ALLOWED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'description', '$id', 'title', 'const']);

function lint(schema, where, problems) {
  if (!schema || typeof schema !== 'object') return;
  for (const k of Object.keys(schema)) if (!ALLOWED.has(k)) problems.push(`${where}: unsupported keyword "${k}"`);
  const types = [schema.type].flat();
  if (types.includes('object')) {
    const keys = Object.keys(schema.properties || {});
    if (schema.additionalProperties !== false) problems.push(`${where}: additionalProperties must be false`);
    const req = new Set(schema.required || []);
    for (const k of keys) if (!req.has(k)) problems.push(`${where}: "${k}" missing from required`);
    for (const [k, v] of Object.entries(schema.properties || {})) lint(v, `${where}.${k}`, problems);
  }
  if (schema.items) lint(schema.items, `${where}[]`, problems);
  for (const [i, s] of (schema.anyOf || []).entries()) lint(s, `${where}|${i}`, problems);
}

test('strict mode: plan schemas', () => {
  for (const name of ['chapter-plan', 'lecture-plan']) {
    const s = schemaOf(name);
    delete s.$id; delete s.title;
    const problems = [];
    lint(s, name, problems);
    assert.deepEqual(problems, []);
  }
});

test('strict mode: every slide type data schema', async () => {
  const types = slideTypes(await buildTemplates());
  const problems = [];
  for (const [pack, byType] of Object.entries(types)) {
    for (const st of Object.values(byType)) lint(llmSchema(st), `${pack}/${st.type}`, problems);
  }
  assert.deepEqual(problems, []);
});
