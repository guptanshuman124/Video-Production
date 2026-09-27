// Physics deck page 14: same design as biology/misconception (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/misconception/template.jsx';
export { default, schema } from '../../biology/misconception/template.jsx';

export const meta = {
  ...base,
  number: 14,
  aliases: [],
  slide: base.slide,
};
