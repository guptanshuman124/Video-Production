// commerce deck: same design as theory/hook (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/hook/template.jsx';
export { default, schema } from '../../theory/hook/template.jsx';

export const meta = {
  ...base,
  number: 1,
  aliases: [],
  slide: { ...base.slide, use: "lecture 1 only, right after the intro: a real business situation (a shopkeeper keeping records, a firm deciding a price, two friends starting a partnership) or a question that shows why the chapter matters — no formal term, rule or format yet" },
};
