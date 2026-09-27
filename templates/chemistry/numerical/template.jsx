// Chemistry deck page 11: same design as physics/numerical, so it reuses that template.
import { meta as base } from '../../physics/numerical/template.jsx';
export { default, schema } from '../../physics/numerical/template.jsx';

export const meta = {
  ...base,
  number: 11,
  aliases: [],
  slide: { ...base.slide, use: "a numerical (mole concept, molarity, rate, EMF…): the problem with its given values, 2–5 solution steps, one final answer with its unit" },
};
