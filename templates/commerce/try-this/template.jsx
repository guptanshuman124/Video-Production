// commerce deck: same design as theory/try-this (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/try-this/template.jsx';
export { default, schema } from '../../theory/try-this/template.jsx';

export const meta = {
  ...base,
  number: 10,
  aliases: [],
  slide: { ...base.slide, use: "an activity or discussion prompt before a concept is formally named: list your family’s monthly expenses, think how a shop knows its profit — no answer shown" },
};
