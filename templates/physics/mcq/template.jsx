// Physics deck page 12: same design as biology/mcq (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/mcq/template.jsx';
export { default, schema, check } from '../../biology/mcq/template.jsx';

export const meta = {
  ...base,
  number: 12,
  aliases: [],
  slide: base.slide,
};
