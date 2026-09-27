// Chemistry deck page 10: same design as biology/mechanism (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/mechanism/template.jsx';
export { default, schema } from '../../biology/mechanism/template.jsx';

export const meta = {
  ...base,
  number: 10,
  aliases: [],
  slide: { ...base.slide, use: "how something works or proceeds, in 2–3 headed stages beside a figure (e.g. a reaction mechanism, an extraction process)" },
};
