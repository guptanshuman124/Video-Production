// Same design as biology/illustration (Prepzy design system), so it reuses that
// template — one implementation, one set of styles.
import { meta as base } from '../../biology/illustration/template.jsx';
export { default, schema, check } from '../../biology/illustration/template.jsx';

export const meta = { ...base, aliases: [], slide: base.slide };
