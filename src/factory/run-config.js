// The factory's run configuration and job folders, shared by the lecture
// child (job.js) and the summary child (summary-job.js).

import path from 'node:path';
import { loadConfig, merge } from '../config.js';

export function jobDir(jobsDir, input) {
  return path.join(jobsDir, `c${input.course_id}`, `m${input.module_id}`, `l${input.lecture_id}`);
}

// The factory's config: jobs on the shared work volume, no LLM response cache
// (every passed stage is already saved as a file, and a retried stage must
// get a fresh answer), render workers per pod from the environment.
export function factoryConfig(jobsDir) {
  const renderJobs = Number(process.env.WORKER_RENDER_JOBS || 0);
  // Sarvam rate-limits bursts: with several workers, each sends fewer requests at once.
  const ttsConcurrency = Number(process.env.WORKER_TTS_CONCURRENCY || 0);
  return merge(loadConfig(), {
    paths: { jobs: jobsDir },
    llm: { cache: false },
    ...(renderJobs ? { video: { jobs: renderJobs } } : {}),
    ...(ttsConcurrency ? { tts: { concurrency: ttsConcurrency } } : {}),
  });
}
