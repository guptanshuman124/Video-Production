// commerce deck: same design as theory/timeline (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/timeline/template.jsx';
export { default, schema } from '../../theory/timeline/template.jsx';

export const meta = {
  ...base,
  number: 5,
  aliases: [],
  slide: { ...base.slide, use: "a dated sequence of 3–6 events in date order: the dates of transactions in a question, the stages of a company’s formation, a historical development (evolution of accounting, of consumer protection law)" },
};
