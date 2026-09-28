// The central pod's view of Kubernetes: read and change the number of worker
// pods (the `worker` Deployment's scale). Uses the pod's service account
// (deploy/k8s/central.yaml grants get/patch on deployments/scale). Outside a
// cluster, `available()` is false and the dashboard hides the control.

import fs from 'node:fs';
import https from 'node:https';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const DEPLOYMENT = process.env.WORKER_DEPLOYMENT || 'worker';

export const available = () => fs.existsSync(`${SA}/token`) && !!process.env.KUBERNETES_SERVICE_HOST;

function request(method, route, body, contentType = 'application/json') {
  const token = fs.readFileSync(`${SA}/token`, 'utf8');
  const ca = fs.readFileSync(`${SA}/ca.crt`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: process.env.KUBERNETES_SERVICE_HOST, port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      path: route, method, ca, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': contentType } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const json = data ? JSON.parse(data) : null;
        if (res.statusCode >= 300) reject(new Error(json?.message || `kubernetes ${method} ${route}: ${res.statusCode}`));
        else resolve(json);
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const ns = () => fs.readFileSync(`${SA}/namespace`, 'utf8').trim();
const scalePath = () => `/apis/apps/v1/namespaces/${ns()}/deployments/${DEPLOYMENT}/scale`;

export async function getWorkerScale() {
  if (!available()) return null;
  const s = await request('GET', scalePath());
  return { desired: s.spec?.replicas ?? 0, current: s.status?.replicas ?? 0 };
}

export async function setWorkerScale(replicas) {
  if (!available()) throw new Error('not running inside Kubernetes');
  const n = Math.max(0, Math.min(12, Math.round(Number(replicas))));
  await request('PATCH', scalePath(), { spec: { replicas: n } }, 'application/merge-patch+json');
  return getWorkerScale();
}
