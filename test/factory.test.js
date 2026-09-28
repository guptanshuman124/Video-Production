import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, safeName } from '../src/factory/catalog.js';

const row = (o) => ({ lecture_active: 1, module_active: 1, course_active: 1, chars: 1000, ...o });
const meta = (courses) => (id) => courses[id] || null;
const packs = { physics: {}, chemistry: {}, biology: {} };

test('catalog: course-table order, numbering and library folders', () => {
  const rows = [
    row({ lecture_id: 12, course_id: 60, module_id: 2, lecture_title: 'COULOMB’S LAW', lecture_order: 2, module_title: 'Electric Charges and Fields', module_order: 1, course_title: 'Physics Part I' }),
    row({ lecture_id: 11, course_id: 60, module_id: 2, lecture_title: 'Introduction', lecture_order: 1, module_title: 'Electric Charges and Fields', module_order: 1, course_title: 'Physics Part I' }),
    row({ lecture_id: 21, course_id: 66, module_id: 9, lecture_title: 'Ray Optics: Basics', lecture_order: 1, module_title: 'Ray Optics', module_order: 1, course_title: 'Physics Part II' }),
    row({ lecture_id: 31, course_id: 70, module_id: 5, lecture_title: 'The Last Lesson', lecture_order: 1, module_title: 'Flamingo 1', module_order: 1, course_title: 'Flamingo' }),
    row({ lecture_id: 99, course_id: 60, module_id: 2, lecture_title: 'Old', lecture_active: 0, module_title: 'x', module_order: 1 }),   // inactive: left out
  ];
  const c = buildCatalog(rows, {
    meta: meta({ 60: { class: 12, subject: 'Physics', pack: 'physics' }, 66: { class: 12, subject: 'Physics', pack: 'physics' }, 70: { class: 12, subject: 'English', pack: 'theory' } }),
    packs,
  });
  assert.equal(c.lectures.size, 4);
  assert.ok(!c.lectures.has(99));
  const intro = c.lectures.get(11);
  const coulomb = c.lectures.get(12);
  assert.equal(intro.lecture_no, 1);
  assert.equal(coulomb.lecture_no, 2);
  assert.equal(coulomb.lecture_title, 'Coulomb’s Law');
  // Two Physics books in Class 12: a book folder between subject and chapter.
  assert.equal(coulomb.library_path, 'Class 12/Physics/Physics Part I/Chapter 1 - Electric Charges and Fields/Lecture 2 - Coulomb’s Law.mp4');
  // One English book: no book folder. No English templates yet: listed but not supported.
  const eng = c.lectures.get(31);
  assert.equal(eng.library_path, 'Class 12/English/Chapter 1 - Flamingo 1/Lecture 1 - The Last Lesson.mp4');
  assert.equal(eng.supported, false);
  assert.match(eng.why, /not built yet/);
  // Queue order: Physics before English, Part I before Part II, lecture order inside a chapter.
  const bySeq = [...c.lectures.values()].sort((a, b) => a.seq - b.seq).map((l) => l.lecture_id);
  assert.deepEqual(bySeq, [11, 12, 21, 31]);
});

test('library names are safe on Windows', () => {
  assert.equal(safeName('Ray Optics: Basics?'), 'Ray Optics Basics');
  assert.equal(safeName('A/B "quoted" <x>'), 'A B quoted x');
  assert.equal(safeName('trailing dots...'), 'trailing dots');
});
