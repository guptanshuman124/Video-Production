// Chemistry deck page 1: same design as biology/chapter-index (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/chapter-index/template.jsx';
export { default, schema } from '../../biology/chapter-index/template.jsx';

export const meta = {
  ...base,
  number: 1,
  aliases: [],
  slide: base.slide,
};
