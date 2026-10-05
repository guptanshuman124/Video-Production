// language deck: same design as biology/misconception (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/misconception/template.jsx';
export { default, schema } from '../../biology/misconception/template.jsx';

export const meta = {
  ...base,
  number: 13,
  aliases: [],
  slide: { ...base.slide, use: 'common mistakes in using the language: the wrong sentence / spelling / form vs the correct one, with why (e.g. "He don’t like" → "He doesn’t like"; ‘आर्शीवाद’ → ‘आशीर्वाद’)' },
};
