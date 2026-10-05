// language deck: same design as theory/concept-intro (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/concept-intro/template.jsx';
export { default, schema } from '../../theory/concept-intro/template.jsx';

export const meta = {
  ...base,
  number: 3,
  aliases: [],
  slide: [{ ...base.slide, use: 'plain-language lead-in right before a grammar idea, a literary device or a writing form is named: the everyday use of language that makes it needed' }, { ...base.slide, type: 'story_summary', name: 'Summary of the text', use: 'the story, poem or chapter in brief (सारांश): 1–3 short paragraphs in the order of the text, before or after reading it closely' }],
};
