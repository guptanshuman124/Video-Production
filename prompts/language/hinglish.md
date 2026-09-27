# LANGUAGE — HINGLISH (voiced)

This text is sent to a text-to-speech engine as it is. It must be **mixed script**: Hindi words in Devanagari, English words in Latin script, in the same sentence. Never romanize Hindi, never write English in Devanagari.

- ✅ `तो चलिए बात करते हैं Meiosis की।`
- ✅ `Nephron का काम है blood को filter करना।`
- ✅ `यह important है कि तुम इसे understand करो।`
- ❌ `Toh chaliye baat karte hain meiosis ki.` — romanized Hindi.
- ❌ `नेफ्रॉन का काम है ब्लड को फ़िल्टर करना।` — English written in Devanagari.
- ❌ `यह महत्वपूर्ण है कि तुम इसे समझो।` — over-translated; a real teacher says "important" and "understand".

**Which words go in Devanagari.** Only simple connective and functional Hindi: pronouns, postpositions, common verbs and question words — `तो, और, है, हैं, को, से, का/की/के, पर, में, कि, यह, वह, कैसे, क्यों, क्या, करते हैं, देखो, चलिए, बताता है`.

**Never use formal/bookish Hindi for a word a teacher says in English.** Write the English word instead:
`महत्वपूर्ण → important` · `आकर्षित → attract` · `पदार्थ → substance / material` · `प्रभाव → effect` · `संबंध → connection / relation` · `वास्तव में → actually` · `उदाहरण → example` · `प्रक्रिया → process` · `सिद्धांत → theory / principle` · `अवधारणा → concept` · `विशेषता → property / feature` · `उपयोग → use` · `परिणाम → result` · `तापमान → temperature` · `ऊर्जा → energy` · `गति → speed / motion` · `बल → force`.

**Everything else stays in English (Latin script):** every technical term, name and unit, and the everyday English words Indian teachers actually say — `important, actually, basically, concept, point, example, question, answer, reason, topic, focus, notice, compare, depend, understand`. When unsure, keep the word in English.

**Formatting for the voice engine:**
- End Hindi sentences with `।`; a sentence that ends on an English clause may end with `.`, `!` or `?`. Use `,` for short beats. `…` at most once or twice.
- Numbers as digits; above four digits use commas (`10,000`). Units, symbols and formulas spoken in words (`H two O`, `x square`, `degrees Celsius`).
- Scientific (binomial) names and proper nouns stay in Latin script as written (*Homo sapiens*, Mendel, NCERT).
- No brackets, tags, `[pause]`, SSML, LaTeX, `$`, `*`, or markdown. Keep the `{{…}}` markers exactly where they are.
