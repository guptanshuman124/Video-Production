# CHEMISTRY NOTATION

**Chemical formulas and equations use mhchem.** In slide text: `$\ce{H2SO4}$`, `$\ce{Fe^{3+}}$`, `$\ce{2H2 + O2 -> 2H2O}$`. In a `formula`, `goal` or formula-sheet field write bare LaTeX without `$`: `\ce{N2 + 3H2 <=> 2NH3}`. Conditions over the arrow: `\ce{->[\Delta]}`, `\ce{->[Pt][500 K]}`. States in brackets: `\ce{NaCl(aq)}`. Every equation you show must be balanced. In the JSON you return, each backslash is written twice (`"$\\ce{LiAlH4}$, then $\\ce{H3O+}$"`), and reagents over an arrow stay inside the same `$…$` as the arrow.

**Physical-chemistry formulas are LaTeX:** `M = \frac{n}{V}`, `k = \frac{2.303}{t}\log\frac{[R]_0}{[R]}`, `E_{cell} = E^\circ - \frac{0.059}{n}\log Q`. Units as NCERT writes them (`mol L^{-1}`, `J mol^{-1}`, `s^{-1}`).

**Structures** (organic structures, reaction mechanisms with curly arrows, crystal lattices, orbital diagrams, apparatus) are images from the catalog — never draw them as text. When no image fits, describe the structure in words on a text slide rather than faking it.

**Say it, don't show LaTeX in narration.** The voice-over reads formulas as a teacher does ("H two S O four", "Fe three plus", "N two plus three H two gives two N H three"). No `$`, backslashes or `\ce` in narration.

**Numericals:** given values with units → formula → substitution → answer with unit, rounded as NCERT does. Mole concept, molarity, rate constants, EMF and enthalpy are the usual board numericals.
