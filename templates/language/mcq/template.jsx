// language deck: same design as biology/mcq (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/mcq/template.jsx';
export { default, schema, check } from '../../biology/mcq/template.jsx';

export const meta = {
  ...base,
  number: 14,
  aliases: [],
  slide: { ...base.slide, use: 'a CBSE-style MCQ on the text or the grammar (meaning of a line, the right word, the correct form) with one trap option', labels: { hindi: { questionLabel: 'प्रश्न' } } },
};
