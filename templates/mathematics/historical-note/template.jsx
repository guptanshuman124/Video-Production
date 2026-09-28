// mathematics deck: same design as theory/person (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/person/template.jsx';
export { default, schema } from '../../theory/person/template.jsx';

export const meta = {
  ...base,
  number: 13,
  aliases: [],
  slide: { ...base.slide, type: "historical_note", name: "Historical note", use: "optional flavour, at most once in a chapter: a mathematician or the origin of a result that NCERT mentions (Aryabhata, Euclid, Ramanujan)" },
};
