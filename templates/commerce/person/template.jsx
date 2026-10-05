// commerce deck: same design as theory/person (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/person/template.jsx';
export { default, schema } from '../../theory/person/template.jsx';

export const meta = {
  ...base,
  number: 8,
  aliases: [],
  slide: { ...base.slide, use: "a key thinker NCERT discusses (Henri Fayol, F. W. Taylor, Luca Pacioli) worth a standalone beat: who they were and why they matter here" },
};
