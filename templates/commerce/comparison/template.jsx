// commerce deck: same design as biology/comparison (Prepzy design system), so it reuses that template.
import { meta as base } from '../../biology/comparison/template.jsx';
export { default, schema, check } from '../../biology/comparison/template.jsx';

export const meta = {
  ...base,
  number: 9,
  aliases: [],
  slide: { ...base.slide, use: "genuinely tabular content: two or three things compared across 3–6 bases (Capital vs Revenue Expenditure, Trade vs Cash Discount, Shares vs Debentures, Planning vs Controlling); also a small vertical statement (Particulars / Note No. / Amount)" },
};
