import test from 'node:test';
import assert from 'node:assert/strict';
import { realCaption } from '../src/generation/assemble.js';
import { sectionsFromBlocks } from '../src/generation/prepare.js';

test('images without a description get no caption — never "No description available"', () => {
  const { images } = sectionsFromBlocks([
    { kind: 'heading', text: '1.1 Leaders' },
    { kind: 'text', text: 'Sardar Vallabhbhai Patel led the integration of the princely states into the Indian Union after independence.' },
    { kind: 'image', src: 'https://x/patel.png', description: '' },
  ], 42);
  assert.equal(images[0].description, '', 'no placeholder text in the catalog');
  for (const s of ['No description available', 'no description', 'N/A', '', '  ', 'Image', null, undefined]) assert.equal(realCaption(s), null, JSON.stringify(s));
  assert.equal(realCaption('Sardar Patel, 1875–1950'), 'Sardar Patel, 1875–1950');
});

test('a slide image without a caption still passes the Content JSON contract', async () => {
  const { checkContract } = await import('../src/contracts/index.js');
  const { assembleLecture } = await import('../src/generation/assemble.js');
  const { buildTemplates } = await import('../src/templates.js');
  const { slideTypes } = await import('../src/slides.js');
  const types = slideTypes(await buildTemplates()).theory;
  const G = {
    prepared: { chapter: { chapter_id: 'c', pack: 'theory', class: 10, subject: 'History', title: 'Nationalism' },
      images: [{ id: 'img_1', url: 'https://x/patel.png', description: '' }], lecture: { title: 'Leaders', title_from_db: true } },
    lecture: { index: 1, title: 'Leaders' }, types, llm: { model: 'mock' },
  };
  const plan = { lecture_title: 'Leaders', slides: [{ slide_type: 'person', title: 'Sardar Patel', image_id: 'img_1', source_refs: [] }] };
  const slides = [{ slide_type: 'person', data: { title: 'Sardar Patel', name: 'Sardar Vallabhbhai Patel', about: 'Integrated the princely states.', caption: 'No description available' } }];
  const { content } = assembleLecture(G, { plan, slides, english: null, hinglish: ['नमस्ते {{b1}}'], gates: {}, promptHashes: {} });
  const img = content.slides[0].image;
  assert.equal('caption' in img, false, 'no caption key at all');
  assert.equal(content.slides[0].data.caption, null, 'the placeholder the writer copied is removed from the slide');
  assert.deepEqual(checkContract('content-v1', content).filter((i) => /caption/.test(i.message || i.path || '')), []);
});
