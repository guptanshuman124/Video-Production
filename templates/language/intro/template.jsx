// language deck: same design as biology/intro (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/intro/template.jsx';
export { default, schema } from '../../biology/intro/template.jsx';

export const meta = {
  ...base,
  number: 0,
  aliases: [],
  slide: { ...base.slide, labels: { hindi: { chapterWord: 'पाठ', lectureWord: 'भाग' } } },
};
