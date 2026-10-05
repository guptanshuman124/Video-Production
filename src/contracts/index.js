// Data contracts between pipeline stages. Each *.schema.json here is the one
// definition of that shape: the validators check against it, and the LLM
// layers send the plan schemas to OpenAI as the structured-output format.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const DIR = fileURLToPath(new URL('./', import.meta.url));
export const CONTRACTS = ['chapter-input', 'lecture-input', 'chapter-plan', 'lecture-plan', 'content-v1', 'summary-content-v1', 'gate-report'];

const ajv = new Ajv({ allErrors: true, strict: false });
const schemas = {};
for (const name of CONTRACTS) {
  schemas[name] = JSON.parse(fs.readFileSync(`${DIR}${name}.schema.json`, 'utf8'));
  ajv.addSchema(schemas[name], name);
}

export const schemaOf = (name) => structuredClone(schemas[name]);

// ajv errors -> gate issues: { code: SCHEMA, severity, path, message }.
export function checkContract(name, data) {
  const validate = ajv.getSchema(name);
  if (!validate) throw new Error(`unknown contract "${name}"`);
  if (validate(data)) return [];
  return validate.errors.map((e) => ({
    code: 'SCHEMA',
    severity: 'error',
    path: e.instancePath || '/',
    message: `${e.instancePath || 'value'} ${e.message}` +
             (e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''),
  }));
}

// A gate's verdict: fail on any error, warn on warnings only, else pass.
export function gateReport(stage, unit, issues = []) {
  const status = issues.some((i) => i.severity === 'error') ? 'fail'
    : issues.length ? 'warn' : 'pass';
  return { stage, unit, status, issues, at: new Date().toISOString() };
}
