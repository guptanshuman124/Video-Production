// commerce deck: same design as biology/assertion-reason (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/assertion-reason/template.jsx';
export { default, schema } from '../../biology/assertion-reason/template.jsx';

export const meta = {
  ...base,
  number: 12,
  aliases: [],
  slide: base.slide,
};
