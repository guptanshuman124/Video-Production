// commerce deck: same design as physics/formula-sheet (Prepzy design system), so it reuses that template.
import { meta as base } from '../../physics/formula-sheet/template.jsx';
export { default, schema, check } from '../../physics/formula-sheet/template.jsx';

export const meta = {
  ...base,
  number: 14,
  aliases: [],
  slide: { ...base.slide, use: "rapid revision of formulas already taught in this lecture (4–12) — ratios, depreciation, gross / net profit, sacrificing ratio, interest on capital — each with a short label; words inside a formula as \\text{…}; only at the end of a lecture" },
};
