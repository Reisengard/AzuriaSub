# Azuria Sub (formerly JIZURA)

The product is named **Azuria Sub** (renamed 2026-10-02; code identifiers, storage keys and file names still say `jizura`). Colour identity: `#121827` `#414652` `#364C6B` `#B39D68`, applied as tokens in `app/style.css` (scoped to the captions product). Browser app (single-file HTML per language) with two working modes: **Lyric Motion** (must not regress) and **Video Captions** (subtitles for one short-form video).

## Source of truth
- `docs/architecture/caption-timing-design.md` — **the approved design for "auto, then exact" caption timing** (Check timing / anchors / pause re-break / Fix timing; slices R1…R4). Nothing implemented yet; ADR 0012 and a drawing come before code.
- `docs/architecture/mcp-assistant-plan.md` — **the plan for the MCP video assistant** (local companion, chat clients drive the editor; slices S00…S17). Proposal, nothing implemented yet. Read it before any MCP/companion work and update slice status when a slice finishes.
- `docs/architecture/captions-editor-rework-plan.md` — the editor rework (timeline, caption editing/sync, interface; steps E0…U6), **all steps done**. Its decisions still describe the editor. It replaces delta-plan items UI-3/4/5.
- `docs/architecture/subtitle-mvp-delta-plan.md` — decisions, audit findings, filename mapping, step plan with status. Earlier decisions, audit findings, filename mapping and step status; its rules still apply.
- `docs/archive/JIZURA_HANDOFF_SUBTITLE_MVP_REVISION.md` — original scope revision; the delta plan overrides it where they differ.
- `docs/architecture/decisions/` — ADRs.
- Where docs and code disagree, trust the code and fix the doc.

## Build
- `src/*.js` are concatenated in **sorted filename order** by `build.py` (no bundler, no modules). Global namespace is `J`. New files must be named so they sort after their dependencies (e.g. `08i_...`).
- `python build.py` regenerates all 7 edition `index.html` files + `sitemap.xml`. Never hand-edit those generated files.
- `python build.py --dev` also writes `dev/www/` (gitignored) for the test tools.
- User-facing strings live in `app/` (`body.html`, `english.py`, `i18n_*.py`); localized builds are tested by `dev/localized_build_test.py`.

## Tests
- Run from `dev/` (`npm install` once). `npm test` runs the chain; run single suites with `node <name>_test.js` or the `test:*` scripts in `dev/package.json`.
- Run suites individually when checking a change: the chain stops at the first failure.
- Lyric Motion guard: `node lyric_smoke.js`. Caption visual snapshots: `node caption_visual_regression.js` (`--update` only when a visual change is intended).
- Export tests use mocks; real H.264 export must be checked in real Chrome.
- AI transcription (ADR 0011) is tested with canned responses (`node caption_transcribe_test.js`); a real run needs a Gemini API key typed into the app.

## Rules for this refactor
- Do one step of the delta plan at a time; each step leaves the app working and tests green.
- Existing projects must load and render identically after a schema migration.
- Determinism: same inputs → same plan. No uncontrolled `Math.random()`; seeds come from `J.h(...)` with project seed, IDs and reroll count.
- Store commands must be undoable and restore IDs, timing, locks and overrides exactly. Keep generated vs manual separation; manual and locked values survive re-planning.
- Never silently move text: overflow / safe-area problems produce warnings.
- Video edits (trim, panels, formats, notes) are kept; caption times are source-video times.
- Commit and push without asking first; commit per step, not mixed with unrelated changes.
- Unrelated scratch files (e.g. `audio_transcript.json`) are intentionally untracked.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
