// theory deck: same design as biology/labeled-diagram (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/labeled-diagram/template.jsx';
export { default, schema } from '../../biology/labeled-diagram/template.jsx';

export const meta = {
  ...base,
  number: 6,
  aliases: [],
  slide: { ...base.slide, use: "image-led: a labelled map, a structure chart, an ecosystem diagram or a photo that carries the content — read part by part" },
};
