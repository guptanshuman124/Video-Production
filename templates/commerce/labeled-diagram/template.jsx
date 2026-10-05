// commerce deck: same design as biology/labeled-diagram (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/labeled-diagram/template.jsx';
export { default, schema } from '../../biology/labeled-diagram/template.jsx';

export const meta = {
  ...base,
  number: 7,
  aliases: [],
  slide: { ...base.slide, use: "image-led: an NCERT chart, format, document specimen (cheque, voucher, invoice) or organisation chart that carries the content — read part by part" },
};
