// Chemistry deck page 17: same design as physics/formula-sheet, so it reuses that template.
import { meta as base } from '../../physics/formula-sheet/template.jsx';
export { default, schema, check } from '../../physics/formula-sheet/template.jsx';

export const meta = {
  ...base,
  number: 17,
  aliases: [],
  slide: { ...base.slide, use: "rapid revision of formulas and key equations already taught in this lecture (4–12), each with a short label, plus an optional symbol key; only at the end of a lecture" },
};
