// Product configuration: config/default.yaml, then config/local.yaml if
// present, then an explicit --config file. Later files override earlier ones
// key by key; arrays are replaced whole.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

const readYaml = (file) => YAML.parse(fs.readFileSync(file, 'utf8')) || {};

export function loadConfig(extra = null) {
  let cfg = readYaml(path.join(CONFIG_DIR, 'default.yaml'));
  const local = path.join(CONFIG_DIR, 'local.yaml');
  if (fs.existsSync(local)) cfg = merge(cfg, readYaml(local));
  if (extra) cfg = merge(cfg, readYaml(path.resolve(extra)));
  return cfg;
}
