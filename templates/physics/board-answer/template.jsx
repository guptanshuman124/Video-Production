// Physics deck: same design as chemistry/board-answer, so it reuses that template.
import { meta as base } from '../../chemistry/board-answer/template.jsx';
export { default, schema } from '../../chemistry/board-answer/template.jsx';

export const meta = {
  ...base,
  aliases: [],
  slide: base.slide,
};
