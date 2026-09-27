// Physics deck: same design as biology/quick-revision (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/quick-revision/template.jsx';
export { default, schema, check } from '../../biology/quick-revision/template.jsx';

export const meta = {
  ...base,
  aliases: [],
  slide: base.slide,
};
