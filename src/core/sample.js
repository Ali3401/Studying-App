/* Lucid — a sample note, so the app is never empty on first run. */

export const SAMPLE = `---
title: The Cardiac Cycle
subject: Physiology
tags: heart, haemodynamics, exam
emoji: 🫀
accent: crimson
---

The cardiac cycle is everything that happens between the start of one heartbeat and the start of the next. At 72 beats per minute one cycle takes about **0.8 seconds**: roughly 0.3 s of systole and 0.5 s of diastole.

::: key The one thing to remember
Blood moves down pressure gradients, and valves only ever open and close because of the pressure difference either side of them. Every event in the cycle follows from that.
:::

## The four phases

::: steps A single beat, start to finish
- **Filling.** AV valves open, ventricles fill passively; atrial contraction tops up the last 20%.
- **Isovolumetric contraction.** All four valves shut. Pressure climbs, volume does not change.
- **Ejection.** Ventricular pressure exceeds arterial pressure, semilunar valves open, blood leaves.
- **Isovolumetric relaxation.** Semilunar valves shut, pressure falls with volume unchanged.
:::

Notice that two of the four phases move no blood at all. They exist because the heart has to build and release pressure against closed valves, and they are where a surprising amount of the oxygen cost of a beat goes.

### Why diastole matters more than you'd think

The coronary arteries fill during ==diastole==, not systole — the contracting myocardium squeezes its own blood supply shut. So anything that shortens diastole shortens the time the heart has to feed itself.

::: warn
This is why tachycardia is dangerous in coronary disease. Diastole shortens far more than systole does as rate rises, so filling time and coronary perfusion time both collapse together.
:::

## Output

::: formula
CO = HR × SV
:::

Cardiac output is typically 5 L/min at rest and can reach 25 L/min in a trained athlete. Stroke volume itself has three determinants:

Preload :: the end-diastolic stretch of the ventricle, set by venous return
Afterload :: the pressure the ventricle must beat to open the aortic valve
Contractility :: the force of contraction at any given fibre length

::: definition Frank–Starling mechanism
Within physiological limits, the more the ventricle is stretched during filling, the more forcefully it contracts. It is what keeps the output of the two ventricles matched beat to beat without any nervous control.
:::

| Measure | Typical value | Changes with |
| --- | --- | --- |
| Heart rate | 60–100 /min | Autonomic tone, fever, drugs |
| Stroke volume | 70 mL | Preload, afterload, contractility |
| Ejection fraction | 55–70 % | Systolic function |
| End-diastolic volume | 120 mL | Venous return, filling time |

::: compare Systole vs Diastole
- Ventricles contract
- AV valves closed, semilunar open
- ~0.3 s at rest
- Coronary flow is squeezed shut
|||
- Ventricles relax and fill
- AV valves open, semilunar closed
- ~0.5 s at rest, shortens fast with rate
- Coronary arteries perfuse
:::

## Heart sounds

The sounds are valves closing, not blood moving.

- **S1 ("lub")** — mitral and tricuspid closing at the start of systole.
- **S2 ("dub")** — aortic and pulmonary closing at the start of diastole. Splits on inspiration, which is normal.
- **S3** — rapid passive filling hitting a compliant ventricle. Normal under 30, a sign of failure after.
- **S4** — atrial contraction against a stiff ventricle. Almost always pathological.

::: mnemonic
**S3 = "SLOSH-ing-in"** (volume overload), **S4 = "a-STIFF-wall"** (pressure overload). The rhythm of the phrase matches the rhythm of the gallop.
:::

::: exam
A question that gives you a heart rate and a stroke volume is asking for cardiac output. A question that gives you end-diastolic and end-systolic volumes is asking for stroke volume first (EDV − ESV), and often ejection fraction after (SV ÷ EDV).
:::

::: summary
- One cycle ≈ 0.8 s: systole 0.3 s, diastole 0.5 s.
- Valves are passive; pressure gradients drive everything.
- Two of the four phases are isovolumetric — pressure changes, volume doesn't.
- CO = HR × SV; SV depends on preload, afterload and contractility.
- Coronary perfusion happens in diastole, so tachycardia starves the heart.
:::

::: quiz
Q: Why does ventricular volume stay constant during isovolumetric contraction?
A: All four valves are shut. Pressure rises but no blood can enter or leave.

Q: What happens to coronary perfusion when heart rate rises sharply?
A: It falls. Diastole shortens disproportionately, and the coronaries fill in diastole.

Q: A patient has EDV 140 mL and ESV 70 mL. What is the ejection fraction?
A: SV = 140 − 70 = 70 mL; EF = 70 ÷ 140 = 50%.

Q: Which valve closure produces S1?
A: The mitral and tricuspid (AV) valves, at the start of systole.

Q: State the Frank–Starling mechanism in one sentence.
A: Greater diastolic stretch produces a more forceful contraction, which matches right and left ventricular output automatically.

Q: Why is an S4 almost always pathological?
A: It means the atrium is contracting against a stiff, poorly compliant ventricle.
:::
`;

export const WELCOME = `---
title: Start here
subject: Lucid
tags: guide
emoji: ✨
accent: indigo
---

This is a note. Everything you paste lands on a page like this one — the same type, the same spacing, the same rhythm, every time.

::: key Three things to try right now
Select a few words and a toolbar appears: five highlight colours, a note, a flashcard. Press **⌘,** to open Appearance and change the theme, the typeface, the line height, the measure — it applies live. Press **⌘K** for everything else.
:::

## Getting text in

Press **⌘N** and paste. If you want the note to look its best, give the AI the format first: open **AI Guide** in the top bar and copy the prompt. Paste that above your lecture material and whatever comes back will already be structured — sections, callouts, a summary, and self-test questions.

::: tip
The prompt is long on purpose. Paste it once at the start of a conversation and every summary after that comes back in the right shape.
:::

## Getting files in

Drop a PDF, a PowerPoint or a Word file onto the import screen. Lucid pulls the text out, rejoins the lines the PDF broke, repairs hyphenated words, throws away the page numbers and running headers, and lays it out like this page. Slide pictures come with it. You can edit anything afterwards.

::: warn
PDFs that are scans of paper have no text in them, only pictures. Lucid will tell you when that happens and offer to bring the pages in as images instead.
:::

## Studying

Every \`::: quiz\` block becomes a flashcard, and so does anything you highlight and turn into one. Press **⌘D** inside a note, or **Study** in the library, to review everything that's due. Grading a card schedules it — again today, or in a few days, or in a few weeks.

::: summary
- **⌘N** new note · **⌘K** everything · **⌘,** appearance
- Select text to highlight, annotate, or make a card
- Import PDFs, PowerPoints and Word files from the library
- Everything stays on this device
:::

::: quiz
Q: Which shortcut opens the command palette?
A: ⌘K — or Ctrl+K if you're not on an Apple device.

Q: Where does Lucid store your notes?
A: In this browser, on this device. Nothing is uploaded anywhere.
:::
`;
