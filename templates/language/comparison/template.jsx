// language deck: same design as biology/comparison (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/comparison/template.jsx';
export { default, schema, check } from '../../biology/comparison/template.jsx';

export const meta = {
  ...base,
  number: 5,
  aliases: [],
  slide: { ...base.slide, use: 'genuinely tabular content: two characters, two poems or two forms compared across 3–6 bases (active vs passive voice, direct vs indirect speech, तत्सम vs तद्भव); first column is the basis' },
};
