// mathematics deck: same design as theory/hook (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/hook/template.jsx';
export { default, schema } from '../../theory/hook/template.jsx';

export const meta = {
  ...base,
  number: 1,
  aliases: [],
  slide: { ...base.slide, use: "lecture 1 only, right after the intro: a real-world hook or puzzle (a pattern, a shape, a money problem) that shows why the chapter matters — no formal maths yet" },
};
