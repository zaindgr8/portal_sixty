---
version: 1
model: flash
---
Built in code, not sent to Gemini: the "AI asks" chips are generated from the validation rules in src/lib/proptech/questions.ts so they are instant and free.
This file documents the wording rules so they can be changed in one place:
- One short question per missing required field, phrased the way an agent would ask a colleague ("Parking spaces?").
- 2–6 quick-tap answers covering the common cases ("0 / 1 / 2 / 3+"), the last one may be "Other…" which opens the field.
- Never ask for something that is already filled, or for the permit number (it has its own block).
