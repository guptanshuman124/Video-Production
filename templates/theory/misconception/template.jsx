// theory deck: same design as biology/misconception (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/misconception/template.jsx';
export { default, schema } from '../../biology/misconception/template.jsx';

export const meta = {
  ...base,
  number: 11,
  aliases: [],
  slide: { ...base.slide, use: "only where a genuine, common student error exists: the wrong belief vs the correct understanding" },
};
