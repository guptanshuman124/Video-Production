// Physics deck page 9: same design as biology/image-points (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/image-points/template.jsx';
export { default, schema } from '../../biology/image-points/template.jsx';

export const meta = {
  ...base,
  number: 9,
  aliases: [],
  slide: { ...base.slide, use: "a figure or graph with 2–5 observations beside it, each with an optional genuine formula" },
};
