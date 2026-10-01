// Same design as biology/process-flow (Prepzy design system), so it reuses that
// template — one implementation, one set of styles.
import { meta as base } from '../../biology/process-flow/template.jsx';
export { default, schema, check } from '../../biology/process-flow/template.jsx';

export const meta = { ...base, aliases: [], slide: base.slide };
