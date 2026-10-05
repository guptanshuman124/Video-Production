// Per-chapter job directory:
//
//   jobs/<chapter_id>/
//     input.json  prepared.json  chapter-plan.json
//     reports/<stage>.json          gate reports for chapter stages
//     L<n>/                         one folder per lecture
//       slide-plan.json slides.json narration-en.json narration-hi.json
//       review.json content.json voice.json cues.json project.json qa.json
//       voice/  assets/  lecture.mp4
//       reports/<stage>.json
//     status.json                   last result of every stage
//     review-queue.json             units that failed a gate after repair
//     llm.jsonl                     every LLM call (tokens, latency, cache)

import fs from 'node:fs';
import path from 'node:path';

const safe = (s) => String(s).replace(/[^\w.-]+/g, '_');

export class JobStore {
  constructor(root, chapterId) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, safe(chapterId));
    fs.mkdirSync(this.dir, { recursive: true });
  }

  path(...parts) { return path.join(this.dir, ...parts); }
  unitDir(lecture) { return lecture ? this.path(`L${lecture}`) : this.dir; }
  has(rel) { return fs.existsSync(this.path(rel)); }
  read(rel) { return JSON.parse(fs.readFileSync(this.path(rel), 'utf8')); }
  write(rel, value) {
    const f = this.path(rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(value, null, 2)}\n`);
    return f;
  }
  remove(rel) { fs.rmSync(this.path(rel), { recursive: true, force: true }); }

  readOr(rel, fallback) { return this.has(rel) ? this.read(rel) : fallback; }

  // Records a gate report for a stage and updates status + review queue.
  record(unit, stage, report, extra = {}) {
    // 'chapter', 'lecture' and 'summary' units report into the job dir itself.
    const prefix = unit === 'chapter' || unit === 'lecture' || unit === 'summary' ? '' : `${unit}/`;
    this.write(`${prefix}reports/${stage}.json`, report);
    const status = this.readOr('status.json', {});
    const counts = { errors: report.issues.filter((i) => i.severity === 'error').length, warnings: report.issues.filter((i) => i.severity === 'warning').length };
    status[`${unit}/${stage}`] = { status: report.status, gate: report.stage, ...counts, ...extra, at: report.at };
    this.write('status.json', status);
    const queue = this.readOr('review-queue.json', []).filter((q) => !(q.unit === unit && q.stage === stage));
    if (report.status === 'fail') queue.push({ unit, stage, gate: report.stage, errors: report.issues.filter((i) => i.severity === 'error'), at: report.at });
    this.write('review-queue.json', queue);
  }
}
