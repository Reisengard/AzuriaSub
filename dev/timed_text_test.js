/* Dependency-free tests for the Gate 1.2 timed-text contract. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({}) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', name), 'utf8');
const jsonFixture = name => JSON.parse(fixture(name));

const canonical = J.importWordJson(fixture('word-timestamps.json'), { duration: 15 });
assert.equal(canonical.tokens.length, 21);
assert.equal(canonical.tokens[0].text, 'Wait,');
assert.equal(canonical.tokens[0].normalizedText, 'wait');
const edited = structuredClone(canonical); edited.tokens[3].text = '43%';
assert.deepStrictEqual(edited.tokens.map(token => token.id), canonical.tokens.map(token => token.id), 'text edits changed stable IDs');

for (const [name, code] of [['invalid-negative-timing.json', 'TOKEN_START_NEGATIVE'], ['invalid-overlap.json', 'TOKEN_TIMING_OVERLAP']]) {
  assert.throws(() => J.importWordJson(jsonFixture(name)), error => error.code === code && error.tokenId === jsonFixture(name).expectedError.tokenId);
}
assert.throws(() => J.validateTranscript(canonical, { duration: 10 }), error => error.code === 'TOKEN_END_AFTER_DURATION' && error.tokenId === 'word_000015');

for (const [name, importer] of [['captions.srt', J.importSrt], ['captions.vtt', J.importVtt]]) {
  assert.throws(() => importer(fixture(name), { language: 'en' }), error => error.code === 'ESTIMATED_TIMING_REQUIRED');
  const imported = importer(fixture(name), { language: 'en', timingQuality: 'estimated', duration: 15 });
  assert.equal(imported.timingQuality, 'estimated');
  assert.ok(imported.tokens.every(token => token.timingQuality === 'estimated'));
  assert.equal(imported.tokens.map(token => token.text).join(' '), canonical.tokens.map(token => token.text).join(' '));
}

const cjk = '字幕は同期する。準備完了！';
for (const forceFallback of [false, true]) {
  const tokens = J.tokenizeCaptionText(cjk, 'ja', { forceFallback });
  assert.ok(tokens.length > 1, 'CJK text was not tokenized');
  assert.equal(tokens.join(''), cjk, 'CJK tokenization lost display text');
}

/* SRT export: cues on the edited timeline, read back with the importer. */
const srtCues = text => text.trim().split(/\n\n/).map(block => { const [index, timing, ...lines] = block.split('\n'), [start, end] = timing.split(' --> '); return { index: Number(index), start, end, text: lines.join('\n') }; });
const sourceSrt = J.importSrt(fixture('captions.srt'), { language: 'en', timingQuality: 'estimated', duration: 15 });
const srtProject = { media: { duration: 15 }, settings: {}, transcript: sourceSrt, segments: [] };
for (let cue = 1; cue <= 6; cue++) {
  const words = sourceSrt.tokens.filter(token => token.id.startsWith(`cue_00000${cue}_`));
  srtProject.segments.push({ id: `seg_${cue}`, tokenIds: words.map(token => token.id), start: words[0].start, end: words[words.length - 1].end });
}
const frozenSrtProject = JSON.stringify(srtProject);
assert.equal(J.exportSrt(srtProject), fixture('captions.srt').replace(/\r/g, ''), 'without cuts the SRT file is the imported one');
assert.equal(JSON.stringify(srtProject), frozenSrtProject, 'exporting changed the project');
assert.throws(() => J.exportSubtitleText(srtProject, { format: 'vtt' }), error => error.code === 'SUBTITLE_FORMAT_REQUIRED');

// Kept: 0–1, 2–5, 9.5–15. Cue 1 crosses the first cut, cue 3 is removed whole, cue 4 loses its start.
srtProject.settings.videoEdit = { format: 'shorts', clips: [{ start: 0, end: 1 }, { start: 2, end: 5 }, { start: 9.5, end: 15 }], panels: [], notes: [] };
const cutSrt = J.exportSrt(srtProject), cutCues = srtCues(cutSrt);
assert.deepStrictEqual(cutCues.map(cue => cue.index), [1, 2, 3, 4, 5], 'cues are numbered from 1 without gaps');
assert.deepStrictEqual(cutCues.map(cue => cue.text), ['Wait, we made 42% more.', 'Now go go go!', 'Three layouts.', 'One clear story.', 'Ready to create?'], 'a caption inside removed material is left out');
assert.deepStrictEqual([cutCues[0].start, cutCues[0].end], ['00:00:00,400', '00:00:01,250'], 'a caption that crosses a cut stays one cue, shorter by the removed part');
assert.deepStrictEqual([cutCues[1].start, cutCues[1].end], ['00:00:02,400', '00:00:03,700'], 'a caption after a cut moves earlier by the removed length');
assert.deepStrictEqual([cutCues[2].start, cutCues[2].end], ['00:00:04,000', '00:00:04,580'], 'a caption that starts in removed material starts at the cut');
const reimported = J.importSrt(cutSrt, { language: 'en', timingQuality: 'estimated', duration: J.videoEditDuration(J.videoClips(srtProject)) });
assert.equal(reimported.tokens[reimported.tokens.length - 1].end, 8.82, 'the last cue ends inside the edited video');

// Japanese words are not spaced apart; captions on another track keep start order; line breaks inside a word cannot end a cue.
const mixedProject = { media: { duration: 10 }, settings: {}, segments: [
  { id: 'a', trackId: 'track_1', tokenIds: ['w1', 'w2', 'w3'], start: 1, end: 3 }, { id: 'b', trackId: 'track_2', tokenIds: ['w4', 'w5'], start: 1, end: 2 },
  { id: 'c', trackId: 'track_1', tokenIds: ['w6'], start: 3.0004, end: 3.0004 }, { id: 'd', trackId: 'track_1', tokenIds: [], start: 4, end: 5 }],
  transcript: { tokens: [['w1', '字幕は'], ['w2', '同期する。'], ['w3', 'OK'], ['w4', 'Title\n\ncard'], ['w5', 'two'], ['w6', 'blink']].map(([id, text]) => ({ id, text })) } };
assert.deepStrictEqual(srtCues(J.exportSrt(mixedProject)), [
  { index: 1, start: '00:00:01,000', end: '00:00:03,000', text: '字幕は同期する。 OK' },
  { index: 2, start: '00:00:01,000', end: '00:00:02,000', text: 'Title card two' }]);
mixedProject.segments[2].end = 3.00045;
assert.deepStrictEqual(srtCues(J.exportSrt(mixedProject))[2], { index: 3, start: '00:00:03,000', end: '00:00:03,001', text: 'blink' }, 'a cue never ends where it starts');
assert.throws(() => J.exportSrt({ media: {}, settings: {}, transcript: { tokens: [] }, segments: [] }), error => error.code === 'SUBTITLE_EXPORT_EMPTY');
assert.match(J.recoveryForError({ code: 'SUBTITLE_EXPORT_EMPTY', message: 'x' }).action, /kept sections/);

console.log('Gate 1.2 timed-text tests passed.');
