// mathematics deck: same design as physics/definition (Prepzy design system), so it reuses that template.
import { meta as base } from '../../physics/definition/template.jsx';
export { default, schema, check } from '../../physics/definition/template.jsx';

export const meta = {
  ...base,
  number: 3,
  aliases: [],
  slide: { ...base.slide, use: "a new mathematical term: the formal definition, 1–3 properties / types, optional small table, and its formula or notation with a symbol key; an image only for geometric terms (chord, tangent, radian) — none for algebraic ones" },
};
