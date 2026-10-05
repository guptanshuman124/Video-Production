// commerce deck: same design as theory/cause-effect (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/cause-effect/template.jsx';
export { default, schema } from '../../theory/cause-effect/template.jsx';

export const meta = {
  ...base,
  number: 6,
  aliases: [],
  slide: { ...base.slide, use: "a directional chain of 3–5 links: the steps of a procedure in order (journal → ledger → trial balance → final accounts; the planning process; issue of shares), or why something leads to something else" },
};
