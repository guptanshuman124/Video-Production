// mathematics deck: same design as biology/comparison (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/comparison/template.jsx';
export { default, schema, check } from '../../biology/comparison/template.jsx';

export const meta = {
  ...base,
  number: 10,
  aliases: [],
  slide: { ...base.slide, use: "genuinely tabular content: a table of values (trigonometric ratios, a data table) or a comparison of 2–3 things across 3–6 bases; first column is the basis / row label" },
};
