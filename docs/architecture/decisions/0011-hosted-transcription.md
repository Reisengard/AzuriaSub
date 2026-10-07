# ADR 0011: Hosted transcription is an opt-in provider with the user's own key

- Status: accepted
- Date: 2026-10-05
- Scope: `src/10g_caption_transcribe.js` (adapter), `src/12c_caption_workbench.js` (dialog, audio extraction), `src/10f_media_recovery.js` (hints), `app/body.html` (`captionTranscribeDlg`), `dev/caption_transcribe_test.js`
- Plan: closes the open item "ASR" of `subtitle-mvp-delta-plan.md` §5

## Decision

1. **One hosted adapter: Gemini 3.5 Transcribe.** "AIで文字起こし" sends the video's soundtrack to `gemini-3.5-transcribe` through the Interactions API (`POST /v1beta/interactions`) with word timestamps (`mode: { type: 'verbatim', timestamp_granularities: ['word'] }`). The Live models (`gemini-3.5-transcribe-live`, Live Translate, 3.8 Live) are for streams: no word timestamps, session limits. They are not used.
2. **The user's own key, from the browser.** The app has no backend and ships no key. The key is typed into the dialog, kept in `localStorage` (`jizura.geminiKey`), sent only in the `x-goog-api-key` header, and never written into a project, autosave or log. "保存したキーを消す" removes it.
3. **Explicit, per run.** Nothing is uploaded until the user presses the start button in a dialog that says the audio goes to Google and that free-tier content may be used by Google to improve its products. Only audio is sent (16 kHz mono WAV made in the browser), not the picture. Requests set `store: false`.
4. **Provider-independent data.** The adapter returns the word JSON `J.importWordJson` already reads (`schemaVersion: 1`, `tokens[{ text, start, end }]`), with `source: 'gemini'` and `timingQuality: 'word'`. In an empty project it enters through the same path as an imported transcript file (`applyTranscript`, not an undo step). When captions already exist it never replaces them (owner decision 2026-10-05): the store command `add-transcript-track` gives the words ids of their own, puts them on the primary track while that is empty and otherwise on a new track, segments and plans only the new captions (every existing caption keeps its words, times and look), and is one undo step. With three tracks already in use the dialog refuses before any audio is uploaded. Since 2026-10-07 an imported transcript file (`.srt`, `.vtt`, word JSON) uses the same rule and command. Schema, segmenter and planner know nothing about the provider.
5. **Provider times are repaired, not trusted.** Words keep spoken order, may not overlap, are clamped into the video, and a "word" holding several Japanese words is split with `J.tokenizeCaptionText`, its time shared by character count. Same response, same words.
6. **Limit: 7 minutes.** The audio is sent inline (20 MB request limit); 16 kHz mono PCM is 32 kB/s plus base64. Longer videos get `TRANSCRIBE_AUDIO_TOO_LONG` and the hint to import a file. No Files API, no chunking.

## Consequences

- Earlier documents said the MVP has no automatic transcription and that hosted ASR must be an explicit provider choice. This is that choice; local-first stays the default and no other feature uploads anything.
- The local path of `mcp-assistant-plan.md` (S06, faster-whisper in the companion, "nothing is uploaded") is unchanged. It emits the same word JSON, so both paths share the import.
- Word timestamps cannot be combined with Gemini's custom vocabulary, and Google notes they may lower text accuracy. Proper nouns and sung lyrics need a manual check; the dialog says so.
- No Japanese accuracy figures were published for this model when this was written. Text and timing quality were not measured here; the automated tests use canned responses.
- The request and response shapes follow <https://ai.google.dev/gemini-api/docs/transcribe> as of 2026-09-23. If Google changes them, only `10g_caption_transcribe.js` changes.
