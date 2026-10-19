# TODOS

## Captions timing

### Use Gemini per-word confidence as a doubt signal

**What:** If the Gemini Transcribe response carries per-word confidence, map it into `token.confidence` and let `J.proposeCaptionEdges` treat low-confidence edge words as doubtful.

**Why:** A second doubt signal, independent of the audio evidence, for the "check" list in Check timing.

**Context:** Canonical tokens already have a `confidence` field (`src/10_timed_text.js:55`), but `src/10g_caption_transcribe.js` never fills it. Nobody has checked whether the response includes it. Look at one live response during R1 benchmarking. Design: `docs/architecture/caption-timing-design.md` (Open Question 3); eng review decision D17.

**Effort:** S
**Priority:** P3
**Depends on:** R1 (Check timing)

### Drop the words-per-caption confirm dialog once it is undoable

**What:** Remove the "単語数を変えると…続けますか？" confirm dialog from the words-per-caption control and rely on Undo.

**Why:** After R3 the change is one undo step (`replan-segments`), which was the dialog's only reason to exist. It's one less click, and other undoable edits don't ask either.

**Context:** The dialog is at `src/12bu_caption_panels_text.js:147`. Eng review D7 kept it on purpose so the switch to `replan-segments` changes nothing visible. Do this as its own small commit after R3, with the D7 golden test green. Remove the string from `app/english.py` and the 5 `i18n_*.py` files.

**Effort:** S
**Priority:** P4
**Depends on:** R3 (pause re-break, `replan-segments`)

## Completed
