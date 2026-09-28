// mathematics deck: same design as theory/practice (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/practice/template.jsx';
export { default, schema } from '../../theory/practice/template.jsx';

export const meta = {
  ...base,
  number: 12,
  aliases: [],
  slide: { ...base.slide, use: "a checkpoint: 1–3 exam-style problems for the student to solve, answers withheld" },
};
