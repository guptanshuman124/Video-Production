// language deck: same design as biology/quick-revision (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/quick-revision/template.jsx';
export { default, schema, check } from '../../biology/quick-revision/template.jsx';

export const meta = {
  ...base,
  number: 16,
  aliases: [],
  slide: { ...base.slide, labels: { hindi: { keyPointsLabel: 'मुख्य बिंदु', glossaryLabel: 'शब्दकोश' } } },
};
