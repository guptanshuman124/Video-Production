// Chemistry deck page 7: same design as physics/derivation, so it reuses that template.
import { meta as base } from '../../physics/derivation/template.jsx';
export { default, schema } from '../../physics/derivation/template.jsx';

export const meta = {
  ...base,
  number: 7,
  aliases: [],
  slide: { ...base.slide, use: "an NCERT derivation in 2–4 steps (e.g. integrated rate law, Nernst equation), each a short line plus one equation, building to a stated goal equation" },
};
