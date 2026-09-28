// theory deck: same design as biology/definition (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/definition/template.jsx';
export { default, schema, check } from '../../biology/definition/template.jsx';

export const meta = {
  ...base,
  number: 3,
  aliases: [],
  slide: { ...base.slide, use: "a named concept, institution, term or literary device (Source, Ecosystem, Constitution, Federalism, Imagery): its meaning in one line, a few properties or types, optional small table; an image only for categories best understood by seeing examples" },
};
