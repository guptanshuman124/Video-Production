// Chemistry deck page 8: same design as biology/labeled-diagram (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/labeled-diagram/template.jsx';
export { default, schema } from '../../biology/labeled-diagram/template.jsx';

export const meta = {
  ...base,
  number: 8,
  aliases: [],
  slide: { ...base.slide, use: "one large NCERT figure (apparatus, structure, mechanism, graph) read out part by part" },
};
