// theory deck: same design as biology/comparison (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/comparison/template.jsx';
export { default, schema, check } from '../../biology/comparison/template.jsx';

export const meta = {
  ...base,
  number: 8,
  aliases: [],
  slide: { ...base.slide, use: "genuinely tabular content: statistics, population figures, or a comparison of 2–3 things (two treaties, two characters, two systems) across 3–6 bases" },
};
