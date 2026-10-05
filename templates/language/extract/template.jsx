// language deck: same design as theory/extract (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/extract/template.jsx';
export { default, schema } from '../../theory/extract/template.jsx';

export const meta = {
  ...base,
  number: 6,
  aliases: [],
  slide: { ...base.slide, use: 'one key line or stanza with its context and what it shows (संदर्भ-प्रसंग, भाव) — quoted exactly; for a line the board often asks about', labels: { hindi: { extractLabel: 'पंक्तियाँ', significanceLabel: 'भाव' } } },
};
