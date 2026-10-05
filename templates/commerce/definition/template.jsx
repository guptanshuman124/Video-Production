// commerce deck: same design as biology/definition (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/definition/template.jsx';
export { default, schema, check } from '../../biology/definition/template.jsx';

export const meta = {
  ...base,
  number: 3,
  aliases: [],
  slide: { ...base.slide, use: "a named term or concept (Asset, Liability, Capital, Depreciation, Management, Partnership Deed): its meaning in one line as NCERT gives it, a few features or types, optional small table" },
};
