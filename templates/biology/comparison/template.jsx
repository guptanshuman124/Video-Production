import { Rich } from 'hvr';
import { Header, SlideTitle, common } from 'hvr/shared';

// Biology deck page 5 (3 columns) and page 6 (4 columns): comparison table.
// Brand header, slide title, one heading row and up to 7 data rows. The first
// column is the row label (bold navy), the rest are plain cells.
// References: reference.png (p5), reference-06.png (p6)

export const meta = {
  name: 'Comparison table',
  number: 5,
  aliases: ['bio-05-comparison-table', 'bio-05', 'bio-5', 'bio-06', 'bio-6', 'comparison-table'],
  description: 'Header + title + table comparing entities across characteristics (2–4 columns, ≤7 rows).',
  duration: 7000,
  slide: {
    type: 'comparison', name: 'Difference / comparison',
    use: 'two (at most three) entities compared across 3–6 bases; first column is the basis',
    image: 'none',
    fields: {
      columns: { required: true, items: [3, 4], words: 4, note: 'e.g. ["Basis", "Mitosis", "Meiosis"]' },
      rows: { required: true, items: [3, 6], words: 8, note: 'one list per row: [basis, cell, cell…], same length as columns' },
    },
    reveal: [{ field: 'rows', each: true, cue: 'reveal' }],
    narrationWords: [220, 320],
  },
};

export const schema = {
  ...common,
  title: { type: 'text', required: true, max: 48 },
  columns: { type: 'list', min: 2, max: 4, of: { type: 'text', max: 28 },
             description: 'heading row, e.g. ["Basis", "Entity A", "Entity B"]' },
  rows: { type: 'list', min: 1, max: 7, of: { type: 'list', of: { type: 'text', max: 90 } },
          description: 'one list per row: [label, cell, cell…], same length as columns' },
  columnWidths: { type: 'list', of: { type: 'number', min: 0 },
                  description: 'relative widths; default matches the reference for 3 columns' },
  uppercase: { type: 'boolean', default: true, description: 'uppercase headings and row labels' },
  reveal: { type: 'list', of: 'any',
            description: 'narration sync: per row, seconds on the video timeline when it appears — ' +
                         'a number, or a list with one time per cell; omit for an automatic stagger' },
};

export function check(d) {
  const errs = [];
  d.rows.forEach((r, i) => {
    if (r.length !== d.columns.length) {
      errs.push(`rows[${i}] has ${r.length} cells but there are ${d.columns.length} columns`);
    }
  });
  if (d.reveal.length && d.reveal.length !== d.rows.length) {
    errs.push(`reveal has ${d.reveal.length} entries but there are ${d.rows.length} rows`);
  }
  d.reveal.forEach((cue, i) => {
    const times = [cue].flat();
    if (!times.every((t) => typeof t === 'number' && t >= 0)) errs.push(`reveal[${i}] must be seconds (number or list of numbers)`);
    else if (Array.isArray(cue) && cue.length !== d.columns.length) errs.push(`reveal[${i}] needs one time per column (${d.columns.length})`);
  });
  if (d.columnWidths?.length && d.columnWidths.length !== d.columns.length) {
    errs.push(`columnWidths has ${d.columnWidths.length} entries but there are ${d.columns.length} columns`);
  }
  return errs;
}

export const animations = {
  riseIn: { dur: 700, ease: 'out',
            kf: [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'translateY(0)' }] },
  cellIn: { dur: 600, ease: 'out',
            kf: [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }] },
  riseOut: { dur: 520, ease: 'inOut',
             kf: [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-28px)' }] },
};

// From the PDF: text starts 33px into a 1769px table, then at 686/1364 (3
// columns) or 585/1039/1482 (4 columns); 24px right padding.
const DEFAULT_WIDTHS = { 2: [653, 1059], 3: [653, 678, 381], 4: [552, 454, 443, 263] };

export default function ComparisonTable(d) {
  const widths = d.columnWidths?.length ? d.columnWidths : DEFAULT_WIDTHS[d.columns.length];
  const cols = widths.map((w) => `minmax(0, ${w}fr)`).join(' ');

  return (
    <>
      <Header lecture={d.lecture} logo={d.logo} />
      <SlideTitle text={d.title} />
      {/* Heading row + data rows enter top-to-bottom, then leave top-to-bottom
          just before the header and title fade out. */}
      <div className={d.uppercase ? 'table caps' : 'table'} style={{ '--cols': cols }}
           stagger={110} delay={350} exitStagger={70} exitDelay={250}>
        <div className="tr thead" anim="riseIn" exit="riseOut">
          {d.columns.map((c) => <div className="th"><Rich text={c} /></div>)}
        </div>
        {d.rows.map((r, i) => {
          // With a reveal cue the row rises in at its earliest time (absolute,
          // i.e. narration time); cells cued later fade up on their own.
          const times = d.reveal[i] == null ? null : [d.reveal[i]].flat().map((t) => t * 1000);
          const rowAt = times ? Math.min(...times) : null;
          const cellAt = (j) => (times?.length > 1 && times[j] > rowAt + 50 ? times[j] : null);
          return (
            <div className={i % 2 ? 'tr alt' : 'tr'} anim="riseIn" at={rowAt} exit="riseOut">
              {r.map((c, j) => (
                <div className={j === 0 ? 'td label' : 'td'} anim={cellAt(j) != null ? 'cellIn' : null} at={cellAt(j)}>
                  <Rich text={c} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
