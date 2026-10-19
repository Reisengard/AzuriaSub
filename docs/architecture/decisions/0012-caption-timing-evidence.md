# ADR 0012: Caption timing evidence and word timing provenance

- Status: accepted
- Date: 2026-10-19
- Scope: `src/10_timed_text.js` (token validation), `src/10c_media_import.js` (`J.mediaContentKey`), `src/12b_caption_store.js` (`set-timing-evidence`, provenance in the timing commands, evidence validation), `src/12c_caption_workbench.js` (runtime audio key), `src/10h_caption_timing_evidence.js` and `src/12by_caption_timing_review.js` (readers, new in R1)
- Plan: `caption-timing-design.md`, eng review task T1 (decisions D3, D6, D12, D13, X2, A3); must be accepted before any R1 code

## Decision

1. **Token field `timingSource`, optional.** It says where a word's *time* came from: `'audio'` (an edge word moved by `snap-caption-edges`, R1), `'anchor'` (a word set by `anchor-token`, R2), `'tap'` (a word stamped by `retime-tokens`, i.e. word sync). Absent means the time is as imported or as derived by a command. `timingQuality` keeps its meaning (`word` / `estimated` / `segment`), `source` keeps its meaning (where the *word* came from: `gemini`, `srt`, `manual`, …) and `boundarySource` is unchanged; there is no `'audio'` boundary value.
   - **Set:** `snap-caption-edges` → `'audio'` on each moved edge word. `anchor-token` → `'anchor'` (with `timingQuality: 'word'`) on the anchored word. `retime-tokens` → `'tap'` on every word it changes (today it only sets `timingQuality: 'word'`, `12b_caption_store.js:653`); it lands in R1 so taps made before R2 are already recorded.
   - **Keep:** commands that move token *ids* or the caption window but never rebuild or re-time a word keep the field: `split-segment` (`12b:416`, except a typed block, whose words carry no `timingSource`), `merge-segments` (`12b:668`), `move-segment-to-track` / `move-tokens-to-track` (`12b:821`, `831`), `set-segment-boundary`, `trim-segment` with `words: 'keep'`, `edit-segment-text` with the same word count (`12b:590-596`, text replaced in place, times untouched), `edit-token-text`, `set-manual-emphasis`, and save/load (`J.loadProject` / `J.saveProject` only clone tokens). `move-segment` (`12b:506-510`) shifts every word of the caption by the same delta and keeps the field: relative word times, which are what `timingSource` protects in R2, do not change, `timingQuality` is kept the same way, and the move sets `boundarySource: 'manual'`, so R1 no longer snaps that caption.
   - **Drop (the rule):** any command that re-spreads or rescales a word's time removes its `timingSource`, because `timingQuality: 'estimated'` together with `'anchor'` would make R2 protect a time nobody set. Concretely:
     - `edit-segment-text` with a changed word count: the rebuilt run goes through `J.canonicalToken` (`12b:608`), which already drops the field. **Code change:** the neighbouring word it borrows when the run has no room (`12b:615-621`, `timed.unshift(before)` / `timed.push(after)`) is re-timed in place and keeps a stale `timingSource`; it must be deleted there.
     - `trim-segment` with `words: 'fit'` (`12b:534-541`). **Code change:** it sets `estimated` but keeps the field. This corrects eng review A3 ("dropped only by text edits that change the word count"); design R2 ("Anchor lifetime") already says fit trims drop anchors.
     - `anchor-token`: the words it re-spreads lose the field (design R2).
   - `J.canonicalToken` (`10_timed_text.js:46-61`) builds a fixed field set, so every import (`J.importWordJson`, SRT/VTT, Gemini), `add-transcript-track` (`12b:768`) and every text-block word (`08l_caption_text_blocks.js:54`) starts without `timingSource`. A word JSON file that carries the field loses it on import, which is correct: its times are "as imported" in this project.
   - **Readers:** R1 eligibility skips a caption whose edge word has `'anchor'` **or `'tap'`** (hand-set times are protected, P4; eng review X2 already makes `'tap'` a barrier like `'anchor'`). R2 treats `'anchor'`, `'tap'` and an edge word with `'audio'` as re-spread barriers.

2. **Stored evidence: one optional top-level field `project.timingEvidence`.**

   ```js
   timingEvidence: {
     audioKey: 'sha256-…',              // J.mediaContentKey(file, duration) of the video it was computed from
     evidence: {
       version: 1, frameMs: 10,
       floor: -52.5,                    // adaptive noise floor, dB, quantized to 0.5 dB
       regions: [[1.204, 2.871, 18.5, 12], …],   // [start, end, onsetStep, offsetStep]
       abstained: false,
     },
   }
   ```

   - `regions` are speech regions in source seconds, rounded to 1 ms, sorted by start and not overlapping. `onsetStep` / `offsetStep` are the energy rise at the start and fall at the end in dB over 30 ms, quantized to 0.5 dB (D13). When `abstained` is `true`, `regions` is empty.
   - **Why top level.** It must survive every path that rebuilds part of a project, and each other place fails one:
     - `project.media`: `J.saveProject` passes it through `J.mediaProjectReference`, which keeps only `MEDIA_FIELDS` (`08a_project.js:160-168`, `10c_media_import.js:8-9, 62-67`), and importing a video replaces it wholesale (`12c_caption_workbench.js:110`).
     - `project.transcript`: `applyTranscript` replaces the whole object when a transcript is imported into a project without captions (`12c:142-148`), although the audio did not change.
     - `project.settings`: survives, but `set-project-setting` (`12b:323-326`) writes any settings field undoably with no shape check. That would be a second, unvalidated write path next to `set-timing-evidence`. Settings also hold the user's choices (video edits), while this is data derived from the audio.
     - A track: evidence belongs to the video, not to one track.

     Nothing whitelists top-level project fields: `J.validateProject` (`08a:105-130`) and `J.validateCaptionProject` (`12b:100`) check named fields only, and `importVideo`, `applyTranscript` and the density control all `clone(ui.store.project)` and change named fields. A top-level field rides along with all of them. It is a captions-mode field; Lyric Motion never reads or writes it.

3. **`audioKey = J.mediaContentKey(file, duration)`**, added to `10c_media_import.js` next to `fingerprintMediaFile` (`10c:51-59`). Same sampling (first and last 64 KiB, `SAMPLE_BYTES`) and the same hash (SHA-256, else the FNV fallback), but the header is `` `${size}:${durationMs}:` `` with `durationMs = Math.round(duration * 1000)` (`duration` = `media.duration` in seconds) instead of `` `${size}:${lastModified}:` `` (`10c:35-40`). So a copied or downloaded file with the same bytes still matches. `fingerprintMediaFile` stays byte-identical, pinned by a test (D6). The key of the linked video is runtime state, computed when a video is imported or relinked; it is never written into `project.media`.

4. **Written only by the undoable store command `set-timing-evidence { evidence, audioKey }`** (D3). It validates the shape (rule 6) and replaces the whole field; there is no partial update and no clearing command. Undo and redo restore whole-project snapshots (`12b:169-196`), so an evidence write must be its own undo entry (or part of a `batch`) to stay exact: undo after a Check timing removes the evidence, redo brings it back. The field is never written through `setProject` (`12c:19-23`), which builds a new `CaptionStore` and wipes undo history. Like every command it updates `updatedAt` and marks the project changed, so it is autosaved and saved with the project.

5. **Mismatch (D12).** The evidence mismatches when a video is linked and its `audioKey` differs from the stored one. With no linked video there is nothing to compare, and the stored evidence is used as is. While it mismatches:
   - Fix timing is disabled.
   - Check timing shows the stored proposals as doubtful only (never pre-ticked).
   - The R2 anchor onset snap is off (the tap time is used).
   - The R3 re-break ignores stored pauses and falls back to word-time gaps.
   - The warning says "Run Check timing again for this video".

   The stored evidence is kept, never dropped or replaced automatically. Only an explicit Check timing replaces it (through `set-timing-evidence`).

6. **Schema: optional fields, no version bump.** `J.PROJECT_SCHEMA_VERSION` stays 3. Old projects have neither field and load, re-plan and render identically (ADR 0004 rule). Verified on the code as of this ADR: neither validator rejects unknown fields today. `J.validateTranscript` (`10_timed_text.js:64-110`) checks named token fields only, and `J.validateCaptionProject` (`12b:100`) checks tracks, segments and plans. Both fields therefore pass validation already. R1 adds checks that run **only when the field is present**:
   - `J.validateTranscript`: `J.TIMING_SOURCES = ['audio', 'anchor', 'tap']` next to `J.TIMING_QUALITIES` (`10:8`); a token whose `timingSource` is set but not in that list fails with `TOKEN_TIMING_SOURCE_INVALID` (beside the quality check at `10:102`).
   - `J.validateCaptionProject`: `J.validateTimingEvidence(project.timingEvidence)` fails with `TIMING_EVIDENCE_INVALID` unless `audioKey` is a non-empty string, `evidence.version === 1`, `evidence.frameMs === 10`, `floor` is finite, `abstained` is a boolean, and `regions` is an array of `[start, end, onsetStep, offsetStep]` finite numbers with `0 ≤ start < end`, sorted and not overlapping, empty when abstained. Region times are **not** checked against `media.duration`: after a different video is imported, the evidence may describe a longer one, and every command would otherwise fail validation (`12b:174`). A newer `evidence.version` fails the same way, which is the signal to write a new ADR.

7. **Consumer audit.** Every reader of `timingQuality`, `source` and `boundarySource`, as of this ADR:

   | Reader | Reads | Change needed |
   |---|---|---|
   | Segmenter, `08e_caption_segmenter.js:163, 176, 184` | `boundarySource`, segmentation locks; copies tokens with `Object.assign` (`08e:154`) and never stores them | None for the fields. R3 adds the pause list through `replan-segments` (eng review D4). |
   | Emphasis `08f:91`, overlap rule `10_timed_text.js:94`, text blocks `08l:31` | `source === 'manual'` (typed words) | None |
   | Import `10_timed_text.js:124, 139-171`, Gemini `10g` | set `source`, `timingQuality` | None; imports start without `timingSource` (rule 1) |
   | `split-segment` / `merge-segments` (`12b:416, 668`) | write `boundarySource` (`'manual'` unless the command passes one) | None; tokens untouched, `timingSource` kept |
   | `move-segment` / `trim-segment` / `set-segment-boundary` (`12b:510, 542, 293`) | write `boundarySource: 'manual'` | `trim-segment` `'fit'`: drop `timingSource` (rule 1) |
   | `edit-segment-text` (`12b:608, 615-621`) | writes `estimated` | Drop `timingSource` on the borrowed neighbour (rule 1) |
   | `retime-tokens` (`12b:653`) | writes `'word'` | Also stamp `'tap'` |
   | `storeBlockTokens` (`12b:923`) | sets transcript-level `timingQuality: 'estimated'` | None (transcript level, not words) |
   | Timeline badge `12bq:275`, caption details `12bt:75-76, 107` | `timingQuality` (transcript, tokens) | None. A provenance label is a UI decision for R1/R2, not required here. |
   | Word sync `isSpoken`, `12bs:21-24` | every word `timingQuality === 'word'` | None. A caption with re-spread (`estimated`) words is already treated as not spoken, so Sync gives it a new window instead of moving it whole; R2 anchoring causes the same, by design. |
   | `.srt` export, `J.subtitleCues` / `J.exportSubtitleText` (`10_timed_text.js:194-227`) | `segment.start` / `end`, `token.text` only | None; snapped edges reach the file through the caption window |
   | MCP plan (`mcp-assistant-plan.md`) | S01 `project()` returns `J.saveProject` and revisions store whole projects; S01 `apply` and S08 write only through store commands; S06 emits word JSON; S07 derives speech regions with VAD in the companion | None. The field rides along with revisions; S08 cannot set `timingSource` directly, and its text corrections (`edit-segment-text`) drop it like a manual edit; S06 words arrive "as imported". S07's VAD regions and `timingEvidence` are separate data, and neither feeds the other. |

## Consequences / known gaps

- Undo snapshots now carry the evidence. A 10-minute video (the `J.TIMING_CHECK_MAX_SECONDS` limit, D8) gives some hundreds of regions, a few to some tens of kB, so 100 snapshots stay well under memory concerns.
- `video.duration` can differ by a millisecond between browsers for the same file, and an environment without SubtleCrypto hashes with FNV, so the same file can produce a different `audioKey`. That only degrades to the mismatch rules (doubtful only); the evidence is never discarded.
- Relink still compares the `lastModified`-bearing fingerprint (`mediaReferencesMatch`, `10c:69-74`; `relink`, `10c:135`), so a copied file is refused by **Relink** and reaches a matching `audioKey` only through importing it as a new video (which replaces `project.media` and keeps the evidence). Loosening relink is not part of this decision.
- The editor's split and merge pass `boundarySource: 'manual'` (`12bt:137, 144`; `12bq:563`), and so do move, trim and the boundary command. Under the design's eligibility rule both halves of a split caption are therefore **Protected** in Check timing. That follows the design as written; whether a split alone should protect timing is for the owner to confirm when R1 is drawn.
- An older build that opens a project with these fields keeps them (it only clones), but its `trim-segment` `'fit'` and text edits will not drop a stale `timingSource`. The only effect is that R1 later protects that word, which errs on the safe side.
- `set-timing-evidence` can be part of a `batch`. Whether Fix timing (R4) puts a first evidence write in the same undo step as its changes is decided in R4.
- Nothing here draws random values or depends on the machine: evidence is stored rounded, proposals are recomputed from the stored evidence, and the same project gives the same proposals and plans everywhere.
