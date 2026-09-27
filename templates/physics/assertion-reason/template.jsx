// Physics deck page 13: same design as biology/assertion-reason (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/assertion-reason/template.jsx';
export { default, schema } from '../../biology/assertion-reason/template.jsx';

export const meta = {
  ...base,
  number: 13,
  aliases: [],
  slide: base.slide,
};
