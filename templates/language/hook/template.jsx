// language deck: same design as theory/hook (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/hook/template.jsx';
export { default, schema } from '../../theory/hook/template.jsx';

export const meta = {
  ...base,
  number: 1,
  aliases: [],
  slide: { ...base.slide, use: 'lecture 1 only, right after the intro: open the lesson — what the text is about, a situation from the student’s own life it connects to, and a question to wonder about while reading (no meaning or grammar yet)', labels: { hindi: { questionLabel: 'सोचिए' } } },
};
