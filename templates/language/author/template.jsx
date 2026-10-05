// language deck: same design as theory/person (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/person/template.jsx';
export { default, schema } from '../../theory/person/template.jsx';

export const meta = {
  ...base,
  number: 2,
  aliases: [],
  slide: { ...base.slide, type: 'author', name: 'Author / poet', use: 'the writer or poet of this text (कवि / लेखक परिचय): who they are, when they wrote, their style, and what this text shows of them — as the textbook presents them' },
};
