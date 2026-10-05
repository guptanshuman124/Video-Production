// language deck: same design as theory/practice (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/practice/template.jsx';
export { default, schema } from '../../theory/practice/template.jsx';

export const meta = {
  ...base,
  number: 15,
  aliases: [],
  slide: { ...base.slide, use: 'a checkpoint: 1–3 board-style questions on the text (short / long answer, extract-based) for the student to answer, answers withheld', labels: { hindi: { label: 'प्रश्न' } } },
};
