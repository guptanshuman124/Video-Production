// mathematics deck: same design as biology/labeled-diagram (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/labeled-diagram/template.jsx';
export { default, schema } from '../../biology/labeled-diagram/template.jsx';

export const meta = {
  ...base,
  number: 9,
  aliases: [],
  slide: { ...base.slide, use: "one large NCERT figure that carries the explanation: a construction, graph, geometric figure or labelled diagram, read part by part" },
};
