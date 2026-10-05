// Same design as biology/process-flow (Prepzy design system), so it reuses that
// template — one implementation, one set of styles.
import { meta as base } from '../../biology/process-flow/template.jsx';
export { default, schema, check } from '../../biology/process-flow/template.jsx';

export const meta = { ...base, aliases: [], slide: { ...base.slide, use: 'the order of events in a story or the steps of a writing task, in 3–6 steps drawn as connected boxes' } };
