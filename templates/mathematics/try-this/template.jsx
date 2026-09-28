// mathematics deck: same design as theory/try-this (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/try-this/template.jsx';
export { default, schema } from '../../theory/try-this/template.jsx';

export const meta = {
  ...base,
  number: 11,
  aliases: [],
  slide: { ...base.slide, use: "a hands-on activity before a definition or concept is formalised (folding, measuring, drawing, spotting a pattern) — no answer shown; especially for Classes 6–8" },
};
