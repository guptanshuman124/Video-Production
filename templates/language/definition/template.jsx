// language deck: same design as biology/definition (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/definition/template.jsx';
export { default, schema, check } from '../../biology/definition/template.jsx';

export const meta = {
  ...base,
  number: 4,
  aliases: [],
  slide: { ...base.slide, use: 'a grammar term or a form (noun, tense, voice, संज्ञा, संधि, समास, a formal letter): its meaning in one line, its kinds or rules as points, an optional small table of kinds with examples' },
};
