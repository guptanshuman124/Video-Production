// Chemistry deck page 2: same design as physics/definition, so it reuses that template.
import { meta as base } from '../../physics/definition/template.jsx';
export { default, schema, check } from '../../physics/definition/template.jsx';

export const meta = {
  ...base,
  number: 2,
  aliases: [],
  slide: { ...base.slide, use: "a named concept, law or process: one-line definition, a few properties, optional small table, and its formula or balanced equation with a key when one exists", fields: { ...base.slide.fields, formula: {"note":"LaTeX without $…$; chemical equations with \\ce{…}, e.g. \"\\ce{2H2 + O2 -> 2H2O}\" — only a genuine NCERT formula/equation"}, formulaFor: {"words":6,"note":"what it gives, e.g. \"molarity\" or \"combustion of hydrogen\" (shown as \"Formula for …\")"} } },
};
