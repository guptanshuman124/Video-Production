// Physics deck page 4: same design as biology/characteristics (Prepzy design system),
// so it reuses that template — one implementation, one set of styles.
import { meta as base } from '../../biology/characteristics/template.jsx';
export { default, schema } from '../../biology/characteristics/template.jsx';

export const meta = {
  ...base,
  number: 4,
  aliases: [],
  slide: { ...base.slide, use: "4–6 genuine properties or features of one thing (e.g. properties of electric charge), each a short title plus one line" },
};
