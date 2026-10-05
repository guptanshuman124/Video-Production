// Same design as biology/labeled-diagram (Prepzy design system), so it reuses that
// template — one implementation, one set of styles.
import { meta as base } from '../../biology/labeled-diagram/template.jsx';
export { default, schema } from '../../biology/labeled-diagram/template.jsx';

export const meta = { ...base, aliases: [], slide: { ...base.slide, use: 'image-led: a picture printed with the lesson, read part by part' } };
