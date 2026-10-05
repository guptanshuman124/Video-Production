// commerce deck: same design as biology/mcq (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/mcq/template.jsx';
export { default, schema, check } from '../../biology/mcq/template.jsx';

export const meta = {
  ...base,
  number: 11,
  aliases: [],
  slide: base.slide,
};
