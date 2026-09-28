// mathematics deck: same design as biology/misconception (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/misconception/template.jsx';
export { default, schema } from '../../biology/misconception/template.jsx';

export const meta = {
  ...base,
  number: 12,
  aliases: [],
  slide: { ...base.slide, use: "real, frequent errors: the wrong belief or step vs the correct one (e.g. \"(a+b)² = a² + b²\")" },
};
