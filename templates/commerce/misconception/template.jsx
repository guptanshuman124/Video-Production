// commerce deck: same design as biology/misconception (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/misconception/template.jsx';
export { default, schema } from '../../biology/misconception/template.jsx';

export const meta = {
  ...base,
  number: 13,
  aliases: [],
  slide: { ...base.slide, use: "only where a genuine, common student error exists (\"drawings are a business expense\", \"every cash receipt is income\"): the wrong belief vs the correct understanding" },
};
