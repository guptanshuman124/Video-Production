#!/usr/bin/env node
// Local Kubernetes for the lecture factory.
//
//   npm run factory -- up        create the cluster if needed, build + load the image, deploy, wait
//   npm run factory -- deploy    rebuild the image and restart central + workers (after code changes)
//   npm run factory -- status    pods and the dashboard URL
//   npm run factory -- logs [central|worker|db]
//   npm run factory -- down      delete the cluster (the videos folder on this PC is kept)
//
// Needs Docker Desktop. kind (Kubernetes in Docker) is downloaded to ~/bin if missing.
// Secrets come from .env: OPENAI_API_KEY, SARVAM_API_KEY, TEXTBOOK_DB_URL (the prepzy-mysql
// URL on this PC; the cluster reaches it through host.docker.internal), and for video storage on
// OneDrive / SharePoint MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SHAREPOINT_SITE_URL.
// After changing .env run `npm run factory -- deploy`.
// FACTORY_LIBRARY overrides where videos are saved (default: <home>\Videos\Prepzy Lectures).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLUSTER = 'lecture-factory';
const CONTEXT = `kind-${CLUSTER}`;
const NS = 'lecture-factory';
const IMAGE = 'lecture-factory:latest';
const KIND_VERSION = 'v0.33.0';
const LIBRARY = path.resolve(process.env.FACTORY_LIBRARY || path.join(os.homedir(), 'Videos', 'Prepzy Lectures'));
const win = process.platform === 'win32';

const say = (s) => console.log(`\n  ${s}`);
function sh(cmd, args, { quiet = false, input, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: quiet || input ? ['pipe', 'pipe', 'pipe'] : 'inherit', input, encoding: 'utf8', shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed${r.stderr ? `:\n${r.stderr}` : ''}`);
  return r;
}
const out = (cmd, args) => sh(cmd, args, { quiet: true, allowFail: true }).stdout?.trim() || '';
const kubectl = (args, opts) => sh('kubectl', ['--context', CONTEXT, ...args], opts);

function kindBin() {
  const onPath = spawnSync(win ? 'where' : 'which', ['kind'], { encoding: 'utf8' });
  if (onPath.status === 0) return onPath.stdout.split(/\r?\n/)[0].trim();
  const local = path.join(os.homedir(), 'bin', win ? 'kind.exe' : 'kind');
  if (fs.existsSync(local)) return local;
  say(`downloading kind ${KIND_VERSION} → ${local}`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const plat = win ? 'windows-amd64' : `${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
  sh('curl', ['-sSL', '-o', local, `https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-${plat}`]);
  if (!win) fs.chmodSync(local, 0o755);
  return local;
}

// Copied from .env into the cluster Secret (OneDrive ones are optional: without them videos stay local).
const SECRET_KEYS = ['OPENAI_API_KEY', 'SARVAM_API_KEY', 'GOOGLE_TTS_CREDENTIALS_B64', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'SHAREPOINT_SITE_URL', 'SHAREPOINT_ROOT', 'LIBRARY_KEEP_LOCAL'];

function readEnv() {
  const f = path.join(ROOT, '.env');
  const env = {};
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => [...SECRET_KEYS, 'TEXTBOOK_DB_URL', 'SOURCE_DB_URL'].includes(k))) };
}

function clusterExists(kind) {
  return out(kind, ['get', 'clusters']).split(/\r?\n/).includes(CLUSTER);
}

function createCluster(kind) {
  fs.mkdirSync(LIBRARY, { recursive: true });
  const cfg = `kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER}
nodes:
  - role: control-plane
    extraMounts:
      - hostPath: "${LIBRARY.replaceAll('\\', '/')}"
        containerPath: /library
    extraPortMappings:
      - containerPort: 30080
        hostPort: 8080
        listenAddress: "127.0.0.1"
`;
  const f = path.join(os.tmpdir(), 'lecture-factory-kind.yaml');
  fs.writeFileSync(f, cfg);
  say(`creating the Kubernetes cluster "${CLUSTER}" (videos → ${LIBRARY})`);
  sh(kind, ['create', 'cluster', '--config', f, '--wait', '120s']);
}

function buildImage(kind) {
  say(`building ${IMAGE}`);
  sh('docker', ['build', '-t', IMAGE, '.']);
  say('loading images into the cluster');
  sh(kind, ['load', 'docker-image', IMAGE, '--name', CLUSTER]);
  // Saves a pull when mysql:8.0 is already on this PC (a multi-platform image may not import; the node then pulls it).
  if (out('docker', ['images', '-q', 'mysql:8.0'])) sh(kind, ['load', 'docker-image', 'mysql:8.0', '--name', CLUSTER], { allowFail: true, quiet: true });
}

function applySecrets() {
  const env = readEnv();
  for (const k of ['OPENAI_API_KEY', 'SARVAM_API_KEY']) if (!env[k]) throw new Error(`${k} is missing from .env`);
  const source = env.SOURCE_DB_URL || env.TEXTBOOK_DB_URL;
  if (!source) throw new Error('TEXTBOOK_DB_URL (the prepzy-mysql URL) is missing from .env');
  const src = new URL(source);
  if (['127.0.0.1', 'localhost'].includes(src.hostname)) src.hostname = 'host.docker.internal';
  // Keep the database password stable across deploys.
  const existing = out('kubectl', ['--context', CONTEXT, '-n', NS, 'get', 'secret', 'factory-secrets', '-o', 'jsonpath={.data.MYSQL_ROOT_PASSWORD}']);
  const pw = existing ? Buffer.from(existing, 'base64').toString('utf8') : crypto.randomBytes(18).toString('base64url');
  const data = {
    ...Object.fromEntries(SECRET_KEYS.filter((k) => env[k]).map((k) => [k, env[k]])),
    MYSQL_ROOT_PASSWORD: pw,
    FACTORY_DB_URL: `mysql://root:${encodeURIComponent(pw)}@factory-db:3306/factory`,
    TEXTBOOK_DB_URL: `mysql://root:${encodeURIComponent(pw)}@factory-db:3306/tutorai`,
    SOURCE_DB_URL: src.toString(),
  };
  const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'factory-secrets', namespace: NS }, type: 'Opaque', stringData: data };
  kubectl(['apply', '-f', '-'], { input: JSON.stringify(secret) });
  const config = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'factory-config', namespace: NS }, data: { LIBRARY_HOST_PATH: LIBRARY } };
  kubectl(['apply', '-f', '-'], { input: JSON.stringify(config) });
}

function deploy({ restart }) {
  kubectl(['apply', '-f', 'deploy/k8s/factory.yaml'], { quiet: true });
  if (restart) kubectl(['-n', NS, 'rollout', 'restart', 'deployment/central', 'deployment/worker'], { quiet: true });
  say('waiting for the database, central and workers');
  kubectl(['-n', NS, 'rollout', 'status', 'statefulset/factory-db', '--timeout=300s']);
  kubectl(['-n', NS, 'rollout', 'status', 'deployment/central', '--timeout=900s']);
  kubectl(['-n', NS, 'rollout', 'status', 'deployment/worker', '--timeout=300s']);
}

function status() {
  kubectl(['-n', NS, 'get', 'pods', '-o', 'wide']);
  say(`dashboard: http://localhost:8080`);
  say(`videos:    ${LIBRARY}\n`);
}

const cmd = process.argv[2] || 'up';
try {
  if (cmd === 'up' || cmd === 'deploy') {
    const kind = kindBin();
    if (!clusterExists(kind)) {
      if (cmd === 'deploy') throw new Error('no cluster yet — run `npm run factory -- up`');
      createCluster(kind);
    }
    buildImage(kind);
    kubectl(['apply', '-f', '-'], { input: JSON.stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: NS } }) });
    applySecrets();
    deploy({ restart: true });
    say('✓ the lecture factory is running');
    status();
  } else if (cmd === 'status') status();
  else if (cmd === 'logs') {
    const which = process.argv[3] || 'central';
    const target = which === 'db' ? 'statefulset/factory-db' : `deployment/${which}`;
    kubectl(['-n', NS, 'logs', target, '--tail=200', '-f', ...(which === 'worker' ? ['--all-pods=true', '--prefix'] : [])]);
  } else if (cmd === 'down') {
    sh(kindBin(), ['delete', 'cluster', '--name', CLUSTER]);
    say(`cluster deleted. Videos are still in ${LIBRARY}\n`);
  } else {
    console.log('usage: npm run factory -- up | deploy | status | logs [central|worker|db] | down');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exitCode = 1;
}
