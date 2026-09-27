import { Rich } from 'hvr';

// Registry template: __ID__
// Reference: templates/__ID__/reference.png (the design this reproduces)

export const meta = {
  name: '__ID__',
  description: 'Describe the slide in one line.',
  duration: 6000,                 // default scene length (ms); a scene may override
};

// Data contract for project JSON: { "template": "__ID__", "data": { … } }
// See templates/README.md for every field type.
export const schema = {
  title: { type: 'text', required: true, max: 80 },
  subtitle: 'text',
};

// Optional template-local animation presets (shadow the globals in stage/anims.js).
export const animations = {};

export default function Slide(d) {
  return (
    <div className="frame">
      <h1 className="title" anim="fadeUp" delay={0}><Rich text={d.title} /></h1>
      {d.subtitle && <p className="subtitle" anim="fadeUp" delay={200}><Rich text={d.subtitle} /></p>}
    </div>
  );
}
