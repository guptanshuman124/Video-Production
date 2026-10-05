// language deck: same design as theory/try-this (Prepzy design system), so it reuses that template.
import { meta as base } from '../../theory/try-this/template.jsx';
export { default, schema } from '../../theory/try-this/template.jsx';

export const meta = {
  ...base,
  number: 10,
  aliases: [],
  slide: { ...base.slide, use: 'a speaking, reading or thinking activity before an idea is named (read the stanza aloud, notice the rhyme, describe your own village) — no answer shown', labels: { hindi: { tag: 'करके देखिए', thinkLabel: 'सोचिए' } } },
};
