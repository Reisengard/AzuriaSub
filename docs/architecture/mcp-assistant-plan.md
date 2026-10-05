# Azuria Sub — MCP video assistant plan

Date: 2026-10-02. Status: **proposal, nothing implemented**. Baseline: `7393e97` on `main`.

This plan supersedes the two earlier drafts (`azuriasub-mcp-implementation-plan.md` and its English copy, both removed). It keeps their architecture and reorders the work so a real MP4 comes out early, against a local client, before any client-specific investment. It does not reopen or change the finished rework plan (`captions-editor-rework-plan.md`, all steps done) or the delta plan; their rules still apply.

Status marks: `[ ]` todo, `[~]` in progress, `[x]` done. Update the mark and add `docs/mcp/evidence/Sxx.md` when a slice finishes.

## 1. Goal

The user points a chat assistant at one video on their PC and gives a general direction, for example: "Remove the long pauses, caption everything, pick an elegant look that does not cover my face." The assistant uses Azuria Sub tools to transcribe, cut, style, look at previews, correct, and export. The user gets a local MP4, SRT/VTT files on the edited timeline, and a project that opens in the manual editor.

"Making the video" means editing and rendering the supplied media. Synthetic scenes, avatars, dubbing, voice replacement and publishing to social networks are out of scope.

### Scope of the first usable version

- Windows 11, one user, one project being worked on at a time, one heavy job at a time.
- One SDR H.264/MP4 source with AAC audio or no audio (the editor's current limits).
- Output is one of the editor's five existing formats (`shorts`, `reels`, `youtube`, `square`, `portrait` in `J.videoFormats`), always 30 fps. No other sizes or frame rates.
- At most `J.CAPTION_MAX_TRACKS` (3) caption tracks.
- Qualified first on videos up to three minutes; real limits are set by measurement.
- Brazilian Portuguese is the main test language, English the second.
- Only looks, animations and layouts the editor already has. The model never supplies code, CSS or HTML.
- Source media is never modified or overwritten; every change is a new revision.

### Client order

1. **A local stdio client** (Claude Desktop or Claude Code) is the development and first-use client. It needs no tunnel, no account features and no remote authentication, so the whole core can be built and proven without external risk.
2. **ChatGPT** follows through an authenticated HTTP transport, once the probe in S00 shows which connection path the account allows.
3. **Grok** and anything else are backlog (section 8).

A feature counts as supported on a client only after a test in that actual product. An API test is not a substitute.

## 2. Decisions

1. **One local companion, one core.** A Node process holds the MCP server, the project store, jobs, transcription and browser control. Clients differ only in transport and authentication.
2. **Keep the current graphics engine.** The companion launches installed Chrome or Edge with a dedicated profile and drives a pinned local build of the editor through an explicit facade (`J.automation`). The model gets no general browser, terminal, file or JavaScript access.
3. **The model decides, the application validates and executes.** Font, colour, size, zone, emphasis and animation are chosen by the conversation's model from catalog IDs. The companion validates, stores a revision and runs exactly that. No second LLM inside the companion.
4. **Determinism is per revision, not per conversation.** The same revision, fonts, seed and versions give the same edit. Two conversations may make different artistic choices.
5. **Local transcription first.** A separate Python worker using faster-whisper with word timestamps; CPU must work, GPU is an optimisation. The existing `transcribe_audio.py` is a personal script and stays as it is; the worker is new code.
6. **Placement by named zone, not free coordinates.** The model picks `top`, `center` or `bottom` (the kinds in `src/08g_caption_zones.js`) per track or per caption. The companion turns that into boxes and checks overlap. Free rectangles are not exposed in the first version.
7. **Few, coarse tools.** Steps with no creative decision are merged into one job, and `get_job` can wait, so a chat client does not have to poll.
8. **Plain files for storage.** One JSON file per revision, written to a temporary name and renamed. No database or journal until a measured need appears.
9. **Companion code is plain JavaScript (ES modules), no build step,** to match the repository. Node 22 or newer.
10. **Autonomy inside an authorised scope.** The user authorises folders once. Inside them, "make the video" runs the whole sequence without a confirmation per reversible change. Anything that sends media to a paid or external service, or writes outside the authorised output folder, needs its own explicit authorisation. The client may add its own confirmations.

## 3. What exists and what is missing

Checked against the code at the baseline.

### Reused

| Area | Where |
| --- | --- |
| Project envelope v3, migrations, load/save, validation | `src/08a_project.js` (`J.loadProject`, `J.saveProject`, `J.validateProject`) |
| SRT / VTT / word-JSON import, timing qualities | `src/10_timed_text.js` (`J.importSubtitleText`, `J.importWordJson`, `J.validateTranscript`) |
| Commands, `batch`, undo/redo, locks | `src/12b_caption_store.js` (`J.CaptionStore`) |
| Looks, style presets, fonts | `src/08m_caption_look.js`, `src/08n_caption_style_preset.js`, `src/02_fonts.js` |
| Zones and readability scoring | `src/08g_caption_zones.js` |
| Cuts, formats, time mapping | `src/10a_video_edits.js` (`J.videoClips`, `J.videoSourceTime`, `J.videoOutputSize`) |
| Frame drawing | `src/11c_caption_compositor.js` (`J.drawCaptionOverlay`), `J.drawVideoEdit` |
| MP4 export | `src/11e_media_export.js` (`J.CaptionVideoExporter`) |
| Driving real Chrome over DevTools, file-backed export of a 3-minute video | `dev/export_chrome_check.js` |

### Facts that shape the design

- The exporter refuses an in-memory export above 30 s of output or 128 MB of source (`MEDIA_FILE_SAVE_REQUIRED`). With `options.writable` it writes through `seek` / `write` / `close` / `abort` only. `dev/export_chrome_check.js` already exports three minutes into an OPFS file and streams it to a local server.
- Export time is source time. Captions are drawn at `sourceTimes[i]`; kept sections come from `settings.videoEdit.clips`.
- `J.validateVideoEdits` rejects more than 100 clips, 100 panels or 100 notes.
- `dev/export_chrome_check.js` reaches the store through the workbench UI (`J.captionWorkbench`, file inputs). There is no public automation entry point.
- Subtitle export on the edited timeline exists for SRT only: `J.subtitleCues` and `J.exportSrt` in `src/10_timed_text.js`, used by the export dialog. There is no VTT writer, no source-timeline file and no output bundle yet.
- Files in `src/` are concatenated in sorted order into every public edition, so the facade ships to the website too. It must do nothing until it is called.
- `ffmpeg` and `ffprobe` are already required by the export check and can be reused for audio extraction and output validation.

## 4. Architecture

```
chat client ── stdio or authenticated HTTP ──> companion (Node)
                                                 ├─ MCP tools
                                                 ├─ project store + revisions + jobs   (%LOCALAPPDATA%\AzuriaSub\)
                                                 ├─ media registry (authorised folders)
                                                 ├─ transcription worker (Python, faster-whisper)
                                                 └─ browser session ── DevTools ──> pinned editor build ── J.automation
```

### Repository layout

- `src/12e_caption_automation.js` — the facade (`J.automation`). Sorts after `12d_caption_autosave.js`.
- `companion/` — its own `package.json`, dependencies pinned, tests with `node --test`.
  - `companion/src/store/` — projects, revisions, media registry, jobs, artifacts.
  - `companion/src/browser/` — launcher, loopback server, DevTools bridge.
  - `companion/src/media/` — probe, audio extraction, output validation.
  - `companion/src/plan/` — edit-plan schema, validation, translation to store commands, time mapping, subtitles.
  - `companion/src/mcp/` — tool registration, stdio and HTTP transports.
  - `companion/workers/transcription/` — Python worker, pinned requirements.
  - `companion/test/`
- `docs/mcp/` — tool reference, setup guide, `evidence/Sxx.md`.
- `dev/fixtures/mcp/` — synthetic or licensed fixtures only.

No user data, credentials, models or temporary files inside the repository.

### Local data

`%LOCALAPPDATA%\AzuriaSub\`:

- `config.json` — authorised input folders, output folder, browser path, transcription settings.
- `media.json` — `mediaId` → real path, size, modified time, fingerprint.
- `projects/<projectId>/revisions/<n>.json` — immutable v3 project per revision; `head.json` names the current one.
- `projects/<projectId>/transcripts/`, `previews/`, `jobs/`.
- `cache/` — extracted audio, removable at any time without touching sources or outputs.
- `lock` — single-instance lock.

Every file is written to `<name>.tmp` and renamed. Outputs are written as `<name>.partial` in the output folder and renamed only after validation.

### Identity and concurrency

IDs are opaque: `projectId`, `mediaId`, `transcriptId`, `revision` (integer per project), `jobId`, `artifactId`. The model never passes a path.

Every changing call carries `expectedRevision`. If the head has moved, the call fails with a conflict and the current revision; nothing is applied. A changing call may carry an `idempotencyKey`; the same key with the same input returns the first result, the same key with different input is an error.

### Timelines

Project times are source times. For kept sections `[a, b)` whose output starts at cumulative offset `o`: `output(t) = o + (t − a)` inside the section; removed material has no output time. For subtitles, each cue is intersected with the kept sections, split where it crosses a cut, removed parts dropped, and the rest remapped. Rounding happens only when the file is written. A single global offset is never used.

### Jobs

Transcription, analysis, preview and export return a `jobId` at once. States: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`. Progress is a stage name plus measurable units; no invented overall percentage. The job record is written before the tool answers. Losing the client connection does not cancel a job. `get_job` takes `waitSeconds` and returns as soon as the job changes state or the wait ends.

### Tools

Registered as they are implemented; a tool that does not work yet is not listed.

| Tool | Purpose | Slice |
| --- | --- | --- |
| `get_capabilities` | Versions, formats, limits, what is verified on this machine | S05 |
| `list_media` | Videos in the authorised folders, as `mediaId` + metadata | S05 |
| `create_project` | New project from a `mediaId` | S05 |
| `get_project` | Head revision summary: format, cuts, tracks, captions (paged), warnings | S05 |
| `import_captions` | SRT / VTT / word-JSON text into the project | S05 |
| `export_project` | Start export of an exact revision: MP4, and from S09 subtitles and project file | S05, S09 |
| `get_job`, `cancel_job` | Follow or stop a job | S05 |
| `list_artifacts` | Finished outputs with path, size, duration, checksum, revision | S05 |
| `analyze_media` | One job: audio extraction, transcription, speech regions, cut candidates | S06, S07 |
| `get_transcript` | Words and segments, paged | S06 |
| `apply_edit_plan` | Validate and apply cuts, captions and style as one new revision; `dryRun` returns the diff and warnings only | S08 |
| `get_style_catalog` | Looks, fonts, animations, formats, zones, limits | S10 |
| `render_preview` | Frames of a fixed revision plus an issue report | S11 |
| `restore_revision` | New revision equal to an earlier one | S13 |
| `open_in_editor` | Open the head revision in the manual editor | S13 |

Never exposed: reading or writing arbitrary files, running commands, arbitrary navigation, evaluating script, or a catch-all "do anything" tool.

Results carry a short readable summary, structured data, IDs, warnings and the valid next steps. Errors are distinct for: unauthorised, capability missing, stale revision, media changed, invalid timing, limit exceeded, disk full, timeout, interrupted.

## 5. Slices

One slice at a time. Each leaves the editor working, the existing tests green and Lyric Motion untouched. Commit and push each slice to `main` on its own.

### Phase 0 — Probe

#### [ ] S00 — ChatGPT feasibility probe

**Depends on:** nothing. Runs beside Phase A and blocks only Phase D.

**Work:** a disposable MCP server with three tools: `ping`, `get_image` (a small synthetic image holding a code word that appears nowhere in text) and `slow_job` (a fake job with a wait). With the target account, try the connection paths the current ChatGPT documentation offers, and record for each: whether the account can use it, what authentication it needs, and whether it survives a new conversation and a restart of the server. Measure the longest tool call and the largest result accepted. Check whether a file attached in the conversation reaches the server in any usable form, and whether the server can hand back a file the user can download in the chat. No private media.

**Deliverable:** `docs/mcp/evidence/S00.md` with the chosen connection path, the minimum reproducible setup, measured limits and a yes / no / fallback line for each of: connection, image reaches the model, attachment in, file out. The disposable server is not kept.

**Acceptance:** the real ChatGPT product calls a tool on the PC and states the code word from the image. Stopping the server gives an error the conversation recovers from. If connection is not possible on the account, that is written down and Phase D is parked; Phases A–C are unaffected.

### Phase A — First MP4 through a local chat client (M1)

#### [ ] S01 — Editor automation facade

**Depends on:** nothing.

**Work:** add `src/12e_caption_automation.js` exposing `J.automation`, with a `version` and these async methods, each returning plain JSON:

- `open({ file, project })` — switch to Video Captions, import the `File`, and load the given project or start a new one.
- `state()` — revision-independent summary: media info, output format, clips, tracks, segments, warnings.
- `importCaptions({ text, kind })` — through `J.importSubtitleText` / `J.importWordJson`.
- `apply(commands)` — one `batch` on the store; all or nothing; returns the diff of changed segment IDs.
- `project()` — the serialised project (`J.saveProject`).
- `renderFrame({ sourceTime, width, captions })` — one composed frame as JPEG bytes, with or without captions, using the export drawing path.
- `export({ writable, quality, signal, onProgress })` — `J.CaptionVideoExporter`.
- `catalog()` — placeholder returning formats and limits; filled in S10.

The facade uses the workbench's store and media controller rather than a second copy, so behaviour equals the UI. It registers nothing, opens nothing and changes no state until a method is called. No new user-facing strings.

**Tests:** `dev/caption_automation_test.js` (added to the chain) for apply/rollback, lock refusal and serialise round-trip; `dev/export_chrome_check.js` gains one scenario that goes through `J.automation` only.

**Acceptance:** a failing command in the middle of `apply` leaves the project unchanged; a command on a locked field is refused; one undo reverts a whole `apply`; an old project loads and renders identically; `node lyric_smoke.js` and the caption visual regression are unchanged; `python build.py` regenerates the editions.

#### [ ] S02 — Companion skeleton and controlled browser session

**Depends on:** S01.

**Work:** create `companion/` with pinned dependencies. Start/stop commands and a `doctor` command (Node, Chrome/Edge path, ffmpeg/ffprobe, H.264 encode support, free disk). Single-instance lock. A loopback HTTP server on a random port that serves the pinned editor build and requires a per-session random token on every request. Launch Chrome or Edge with a dedicated profile directory under the data folder, connect over DevTools, and expose one internal function, `callFacade(method, args)`, which is the only path into the page. Recovery when the browser exits; the companion closes only processes it started. Carry over the lessons from `dev/export_chrome_check.js` (hidden pages defer `<video>` loading; Edge and Chrome differ when minimised) without reusing its test server.

**Acceptance:** `callFacade('state')` works from a test; the DevTools port and the loopback server are unreachable from another machine and refuse requests without the token; a page from another origin cannot call the server; the personal browser profile is never touched; a second companion start reports the running one and exits. Visible and minimised windows are both tested; headless is used only if this machine proves it works for export.

#### [ ] S03 — Data folder, media registry and revisions

**Depends on:** S02.

**Work:** `config.json` with authorised input folders and one output folder, edited by a `companion config` command (a settings page is backlog). Media registry: scan the authorised folders for supported files, assign `mediaId`, store real path, size, modified time and a fingerprint; probe with ffprobe. Resolve real paths and refuse anything outside the authorised folders, including through junctions and symlinks. Project store with integer revisions, `head.json`, `expectedRevision`, idempotency keys, atomic writes. Media is streamed to the page from the loopback server by `mediaId`, never by path.

**Acceptance:** tests reject a path outside the roots, a junction escaping a root, a `mediaId` of a removed file, and a file changed since registration (clear "media changed" error). Unicode names and spaces work. Restart keeps projects and revisions. A killed write never leaves a half-written revision as head. Nothing is stored in the repository.

#### [ ] S04 — Jobs and disk-backed export of any length

**Depends on:** S02, S03.

**Work:** job records, the queue (one heavy job at a time), cancel, and `waitSeconds`. Export job: load the exact revision in the page, export through the facade into a file-backed writable, move the bytes to the companion without passing a whole MP4 through JSON, base64 or DevTools, write `<name>.partial`, validate with ffprobe (decodes, expected size, 30 fps, frame count matches the edited duration, audio present when the source has it), then rename and register the artifact with a checksum. Start with the route the export check already proves (OPFS file, then a streamed upload to the loopback server); compare it with a writable that sends positioned chunks straight to the companion and keep the one that measures better on a three-minute file. On start, any job left `running` becomes `interrupted` and its partial file is removed.

**Acceptance:** exports of 15 s, 3 min and a source above 128 MB succeed with page memory measured and bounded; cancel stops the export and leaves no file; a simulated browser crash, a full disk and a killed companion never leave a partial file named as final; output names never overwrite an existing file; the same idempotency key does not start a second export.

#### [ ] S05 — MCP server over stdio and the first tools

**Depends on:** S03, S04.

**Work:** the official MCP SDK, pinned. Tools: `get_capabilities`, `list_media`, `create_project`, `get_project`, `import_captions`, `export_project`, `get_job`, `cancel_job`, `list_artifacts`. Server instructions that describe the workflow in a few lines. Setup guide in `docs/mcp/` for the local client. Tool text returned from media (file names, caption text) is marked as data.

**Acceptance (M1):** in the real local client, a request such as "caption `<video>` with this SRT and export it" produces a validated MP4 in the output folder, and the reply names the real artifact. Also passes in MCP Inspector. Closing the client during an export does not stop it. A wrong `expectedRevision` is refused with the current revision.

### Phase B — Automatic editing (M2)

#### [ ] S06 — Audio extraction and local transcription

**Depends on:** S04, S05.

**Work:** extract audio with ffmpeg to a stable mono format for ASR, keeping the audio track's start offset so word times map back to source time; cache by media fingerprint and settings. Python worker in `companion/workers/transcription/` with pinned requirements and its own virtual environment: faster-whisper, word timestamps on, model and compute type from config, CPU path required, GPU used when the `doctor` check passes. Verified model download as a separate, cancellable step. Chunking for longer media with de-duplication at chunk borders. Normalise to the word-JSON the editor already imports; keep the raw output beside it. Report language, per-word probability where available and the real timing quality. `analyze_media` starts the job; `get_transcript` pages the result.

**Acceptance:** on the fixtures: words are monotonic, inside the source duration and aligned to the offset; a silent file yields no captions; a file without audio returns a clear result, not a failure; PT-BR punctuation and proper names are recorded as measured, not assumed. A machine without a usable GPU still completes. Nothing is uploaded anywhere. Cancel kills the worker.

#### [ ] S07 — Speech regions and cut candidates

**Depends on:** S06.

**Work:** in the same `analyze_media` job, derive speech regions from VAD plus word times, and propose kept sections. Parameters: minimum pause to cut, margin kept before speech, margin kept after speech, shortest kept section. Starting values to tune on the fixtures: cut pauses over 700 ms, keep 120 ms before and 180 ms after. The VAD used inside ASR must not hide the gaps needed here. Raise the clip limit in `J.validateVideoEdits` from 100 to a tested value for `clips` only (panels and notes stay at 100), with `dev/video_edits_test.js` cases and a check that the trim UI and export stay responsive at the new limit. Above the limit the tool returns a "limit exceeded" error with the count; it never drops or silently merges sections.

**Acceptance:** no word is clipped in the annotated fixtures; quiet speech survives; music without speech and video without speech produce a warning and no cuts, never an empty output; candidates are returned with a reason and the pause length; applying them is a plan operation (S08), not a side effect.

#### [ ] S08 — Edit plan: validate and apply as one revision

**Depends on:** S01, S06, S07.

**Work:** `EditPlan` v1: base revision, output format (one of the five), fit, kept sections in source time, transcript reference, caption text corrections, global style (look, preset fields), per-track zone, per-caption patches (look, zone, emphasis, animation off), and a short reason per decision. Values are finite numbers, enums or catalog IDs; HTML, CSS, script, paths and commands are rejected by the schema. The companion translates the plan to store commands and applies them as one `batch` through the facade. `dryRun: true` returns the diff, warnings and counts without saving. Text corrections are stored separately from the raw transcript. Locked fields and manual overrides are never overwritten; a plan that tries is refused with the list of fields.

**Acceptance:** repeating a call does not duplicate captions; an invalid plan leaves the head unchanged; a manual edit made in between causes a conflict; reopening shows the same decisions; an export started on revision *n* renders revision *n* even if *n+1* appears meanwhile; the same plan on the same base gives the same project bytes.

#### [ ] S09 — Subtitles on the edited timeline and the output bundle

**Depends on:** S08.

**Work:** SRT and VTT writers using the rule in section 4, for both the source timeline and the edited timeline, with the timeline named in the file name. Build on the existing `J.subtitleCues` / `J.exportSubtitleText` (edited timeline, SRT) instead of writing a second one. That writer keeps a caption that crosses a cut as one cue, because its kept parts play back to back on the edited timeline. `export_project` now produces, for one revision: the MP4, the edited-timeline SRT and VTT, the project JSON, and a manifest (duration, size, codec, revision, checksums).

**Acceptance (M2):** a cue crossing one or several cuts is split correctly; removed text never appears; no cue ends after the video; accents and line breaks survive; the files pass an independent parser and play in sync with the MP4 in a player. In the local client, "transcribe this, remove long pauses, caption it, export" works end to end.

### Phase C — Visual direction (M3)

#### [ ] S10 — Style catalog

**Depends on:** S05, S08.

**Work:** fill `J.automation.catalog()` from the real registries: looks (`J.CAPTION_STANDARD_LOOKS`, `J.captionLookOptions`), look settings with their ranges, fonts that are bundled and load locally, animations, emphasis options, formats, zone kinds, track and clip limits. Each entry has a stable ID and a one-line description by intent ("quiet", "word-by-word emphasis"). `get_style_catalog` returns a compact index and, on request, the detail of one group, so the whole library is not sent every time. Style fields become valid in `EditPlan`.

**Acceptance:** every ID in the catalog applies successfully; an unknown ID is rejected with the nearest valid ones; a font that fails to load gives an error or a declared fallback, never a silent layout change; the catalog is generated from code, with a test that fails when a look is added without a description.

#### [ ] S11 — Previews and objective checks

**Depends on:** S08, S10.

**Work:** `render_preview` for a fixed revision: frames at requested output times, plus defaults (start, middle, end, just after each cut, and the entrance and settled state of a sample of captions). Each frame can be requested with or without captions, so the model can look at the bare picture first. Frames are reduced in size and returned as MCP image content with source time, output time and revision; a budget caps frames and pixels per call. The report lists measurable problems per caption: overflow, outside the safe area, too small, too dense (characters per second), too short on screen, low contrast, using the readability rules in `src/08g_caption_zones.js`. Frames come from the same drawing path as export.

**Acceptance:** a preview frame and the same frame decoded from the exported MP4 differ only within a stated tolerance; a code word visible only in a frame is read back by the model in the local client; requests outside the duration, for another revision or over budget are refused; warnings name the caption IDs. The assistant is told it saw sampled frames, not the whole video.

#### [ ] S12 — Placement by zone and face avoidance

**Depends on:** S11.

**Work:** zone choice per track and per caption in the plan (`top`, `center`, `bottom`), turned into boxes by the companion with `J.createCaptionZone`. Spike, then decide: a local face detector run on sampled frames inside the companion's browser session (not in the public editor build), with its licence recorded and its accuracy measured on fixtures with faces in different positions. If it qualifies, `render_preview` reports captions whose box overlaps a detected face, per sampled frame, and the model moves them. If it does not, avoidance rests on the model's reading of the preview frames, and the documentation says so. Coordinates are in the output frame, after crop and fit.

**Acceptance:** on the face fixtures, overlaps are reported at the sampled frames and a plan revision removes them; caption position is stable within a caption and does not jump between neighbours without a reason. The product never claims captions "never cover faces"; it reports what was sampled.

#### [ ] S13 — Review loop, follow-up changes and the manual editor

**Depends on:** S10–S12.

**Work:** server instructions and tool descriptions for the full sequence: read the brief, analyse, plan, dry-run, apply, preview, correct, export. Budgets enforced by the companion: two automatic correction rounds by default (configurable), frame and job caps; when a budget runs out the tool says so and the best valid revision is kept. Follow-up edits are plan patches on the head revision that change only what was asked. `restore_revision` creates a new revision equal to an old one. `open_in_editor` opens the head revision in the manual editor in the companion's browser; saving there writes a new revision through the facade, and a chat edit on the older revision then gets a conflict. Instructions found inside transcripts or frames are treated as content, never as commands.

**Acceptance:** three different briefs give visibly different, coherent styles within the catalog; the model fixes a deliberately bad caption after seeing the preview, and reduces effects when asked; "make only the last caption larger" changes only that caption; a manual text or position fix survives a later plan; restore keeps IDs and locks exactly. A person, not only the model, judges the looks.

#### [ ] S14 — Qualification of the local-client version

**Depends on:** S00–S13 as far as they apply to the local client.

**Work:** the full flow on at least ten fixture videos in the real local client: direct request, vague request, follow-up correction, cancel, restart during a job. Measure time, memory and disk. Review what leaves the PC (transcript text and preview frames go to the model's provider; media, audio and renders stay local) and state it in the setup guide.

**Acceptance (M3):** the main scenario passes three times in a row without duplicate jobs or lost data; no technically invalid output; cuts, sync and readability approved by a person on the reference videos; known aesthetic weaknesses listed. Full existing test chain, Lyric Motion smoke and caption visual regression green.

### Phase D — ChatGPT (M4)

#### [ ] S15 — HTTP transport and authentication

**Depends on:** S00 (a workable connection path), S05.

**Work:** Streamable HTTP transport on the same tool registry, bound to loopback and reached only through the connection path S00 selected. Authentication as that path requires, origin and host checks, request size and rate limits, revocation from the companion. The tunnel or endpoint exposes MCP only: not the DevTools port, not the editor server, not files.

**Acceptance:** MCP Inspector and the real ChatGPT product both list and call the tools; missing, expired and revoked credentials get nothing; local authorisation holds whatever the client's own confirmations say.

#### [ ] S16 — ChatGPT qualification, attachments and delivery

**Depends on:** S14, S15.

**Work:** repeat the S14 scenarios in ChatGPT, including the image code-word test. Then act on the S00 findings: if an official mechanism lets an attached video reach the server, implement it with authorisation, a byte limit, controlled redirects and a block on internal addresses; if an official mechanism lets a result be downloaded in the chat, implement it with a checksum, expiry and an explicit user choice to send the file. Where neither exists, the supported flow is "choose the file in an authorised folder, find the result in the output folder", and the documentation says exactly that.

**Acceptance (M4):** the full flow works in ChatGPT on the reference videos. The capability table in `docs/mcp/` states, per client, each of: connection, images to the model, attachment in, file out — verified, fallback or unsupported, with the date tested. A whole MP4 is never sent inside a tool result.

### Phase E — Operation

#### [ ] S17 — Reliability, privacy and limits

**Depends on:** S14.

**Work:** sleep and resume, full disk, browser crash, source file changed or drive missing, connection dropping mid-job, update of the companion while a job runs. Cache retention and a disk budget; clearing the cache never removes sources or outputs. Logs without caption text, frames or credentials by default; a diagnostic bundle that leaves out media and text unless the user opts in. Measured time and memory targets for this hardware replace any assumed numbers.

**Acceptance:** no overwritten source, no partial file presented as final, no silent wrong output on a font or codec failure, in any of the above cases.

## 6. Milestones

- **M1** (S01–S05): a local chat client exports a captioned MP4 from supplied captions.
- **M2** (S06–S09): transcription, pause removal, captions and subtitles, fully automatic.
- **M3** (S10–S14): the model chooses the look, inspects previews, corrects and handles follow-ups.
- **M4** (S15–S16): the same in ChatGPT, to the extent S00 found possible.
- S00 runs any time before S15. S17 follows M3 and may come before or after M4.

No day estimates are given before S02 and S04 are done; they hold the main technical unknowns (browser control and moving large output to disk). Re-estimate after them.

## 7. Done means

For every slice:

1. The acceptance points are shown, with tests for behaviour and failure, not only schema examples.
2. Existing projects load and render the same; seeds, locks and undo behave as before; `node lyric_smoke.js` passes; caption visual snapshots change only when intended.
3. Editor changes go through `python build.py`; generated `index.html` files are never edited by hand.
4. New dependencies are pinned and their licences added to `THIRD_PARTY_NOTICES.md`.
5. No credentials, private media or model files in Git.
6. `docs/mcp/evidence/Sxx.md` records the version, the scenario run, the result and the limits found. It is written when the slice is done, never in advance.
7. The slice's mark in this file is updated and the slice is committed on its own.

Media criteria: the MP4 decodes, is 30 fps, has the requested format's size and a frame count matching the edited duration; audio and video stay within one frame of each other at synthetic reference points; no clipped words on the annotated fixtures; nothing is called finished before it is validated and on disk.

## 8. Backlog, not planned in slices

Each needs its own scope before work starts: Grok connector; packaging the stdio server as a Claude Desktop extension; a settings and results page for the companion; external (paid) transcription as an explicit choice with a spending limit; conversion of other input formats, HDR and HEVC; scene-change sampling and per-scene placement; reusable style profiles across videos; a Windows installer and updates; a public gateway with device pairing for other users; catalog submissions; multiple videos, diarisation, translation.

## 9. Risks

- **ChatGPT connection, images or files are not available on the account.** S00 finds out early; the local client keeps the product usable.
- **Hidden or minimised browser slows or stalls export.** Known from the export check; S02 tests window states and keeps a visible-window path.
- **Transcription is slow on CPU or weak on names.** Measured in S06; a larger model, GPU, or the backlog's external provider are the options, each chosen by the user.
- **More cuts than the clip limit.** S07 raises the limit with tests and returns an explicit error beyond it.
- **Chat clients do not poll or cap tool-call time.** `waitSeconds` on `get_job`, with the real cap measured per client.
- **The model's placement judgement from sampled frames is weak.** Named zones plus the detector spike in S12; no promise beyond what was sampled.
- **The facade ships in the public editions.** It is inert until called and adds no UI; S01 tests that loading the app is unchanged.

## 10. External references

Read when the first drafts were written and **not re-verified for this plan**. Each must be rechecked against the real account in the slice that uses it.

- ChatGPT MCP connection: <https://developers.openai.com/plugins/deploy/connect-chatgpt>, <https://developers.openai.com/api/docs/guides/secure-mcp-tunnels> (S00, S15)
- Grok connectors: <https://docs.x.ai/grok/connectors> (backlog)
- Claude Desktop local MCP servers: <https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop> (S05)
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper> (S06)

The next task is **S01**, with **S00** alongside whenever the account steps can be done.
