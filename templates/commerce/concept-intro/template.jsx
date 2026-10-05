// commerce deck: same design as theory/concept-intro (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/concept-intro/template.jsx';
export { default, schema } from '../../theory/concept-intro/template.jsx';

export const meta = {
  ...base,
  number: 2,
  aliases: [],
  slide: { ...base.slide, use: "plain-language lead-in right before a new term, rule or format is named: the everyday business situation or question that makes the idea needed" },
};
