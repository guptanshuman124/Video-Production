// Physics deck page 5: same design as biology/comparison (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/comparison/template.jsx';
export { default, schema, check, animations } from '../../biology/comparison/template.jsx';

export const meta = {
  ...base,
  number: 5,
  aliases: [],
  slide: { ...base.slide, use: "two (at most three) quantities or phenomena compared across 3–6 bases (e.g. distance vs displacement); first column is the basis" },
};
