/* Step 5: caption roles (base / active / emphasis), no reflow, fonts. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const clone = value => JSON.parse(JSON.stringify(value));
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const code = fn => { try { fn(); } catch (error) { return error.code; } return null; };
const make = () => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'preset', media: { duration: 15, width: 1080, height: 1920 },
    transcript, segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z' };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans;
  return new J.CaptionStore(J.loadProject(clone(project)));
};
const TRACK = J.CAPTION_PRIMARY_TRACK_ID;

/* source project: styled every way a look can be set */
const source = make();
source.execute({ type: 'set-caption-style', style: { preset: 'punchy', captionTreatment: 'neon', accentColor: '#22ccff', motion: .3, intensity: .4, alignment: 'left', editor: 'advanced', segmentation: { maxWords: 7, targetWords: 5 } } });
source.execute({ type: 'set-caption-look', look: { enter: 'captionSoftRise', active: 'captionActiveScale' }, lookSettings: { enter: { all: { duration: .6 } } } });
source.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { color: '#ffee00' }, emphasis: { color: '#ff0066', scale: 1.1 }, active: { treatment: 'captionActiveWeight' } } });
source.execute({ type: 'set-track-style', trackId: TRACK, style: { motion: .8 } });
source.execute({ type: 'set-technique', set: 'wa', value: true });
const preset = J.captionStylePreset(source.project);
assert.equal(preset.kind, 'jizura-caption-style');
assert.equal(preset.style.segmentation, undefined, 'word density is not part of a look');
assert.equal(preset.style.look.enter, 'captionSoftRise');
assert.equal(preset.tracks[0].roles.emphasis.color, '#ff0066');

/* target project: different look, its own density, its own words */
const target = make();
target.execute({ type: 'set-caption-style', style: { preset: 'creator', segmentation: { maxWords: 3, targetWords: 2 } } });
const words = JSON.stringify(target.project.transcript), timing = JSON.stringify(target.project.segments.map(item => [item.id, item.start, item.end]));
const before = JSON.stringify(target.project);
target.execute({ type: 'apply-caption-style', preset: J.parseCaptionStylePreset(JSON.stringify(preset)) });
const p = target.project;
assert.equal(p.style.preset, 'punchy'); assert.equal(p.style.captionTreatment, 'neon'); assert.equal(p.style.editor, 'advanced');
assert.deepStrictEqual(p.style.look, source.project.style.look); assert.deepStrictEqual(p.style.lookSettings, source.project.style.lookSettings);
assert.deepStrictEqual(p.style.segmentation, { maxWords: 3, targetWords: 2 }, 'the target keeps its own density');
assert.deepStrictEqual(p.tracks[0].roles, source.project.tracks[0].roles); assert.equal(p.tracks[0].style.motion, .8);
assert.equal(p.techniques.wa, true);
assert.equal(JSON.stringify(p.transcript), words, 'words untouched');
assert.equal(J.captionResolvedPlan(p.plans[p.segments[0].id]).entrance, 'captionSoftRise', 're-planned with the loaded look');
target.undo();
assert.equal(JSON.stringify(target.project), before, 'one undo restores everything');
assert.equal(JSON.stringify(target.project.segments.map(item => [item.id, item.start, item.end])), timing);

/* into one track: only that track changes, and each track can take a file of its own */
{
  const other = make();
  other.execute({ type: 'set-caption-style', style: { preset: 'creator', captionTreatment: 'echo', accentColor: '#00ff88' } });
  other.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { color: '#00ff88' } } });
  const presetB = J.captionStylePreset(other.project);
  const store = make();
  store.execute({ type: 'add-transcript-track', transcript: J.importWordJson({ schemaVersion: 1, language: 'en', tokens: [{ text: 'Second', start: 0.2, end: 0.6 }, { text: 'track', start: 0.7, end: 1.1 }] }, { duration: 15 }), trackId: 'track_2' });
  store.execute({ type: 'set-track-style', trackId: 'track_2', style: { segmentation: { maxWords: 2 } } });
  const projectStyle = JSON.stringify(store.project.style), primary = JSON.stringify(store.project.tracks[0]), start = JSON.stringify(store.project);
  store.execute({ type: 'apply-caption-style', preset, trackId: 'track_2' });
  let q = store.project, second = q.tracks[1], own = q.segments.find(item => item.trackId === 'track_2');
  assert.equal(JSON.stringify(q.style), projectStyle, 'the project style is not touched');
  assert.equal(JSON.stringify(q.tracks[0]), primary, 'the other track is not touched');
  assert.equal(second.style.preset, 'punchy'); assert.equal(second.style.captionTreatment, 'neon'); assert.equal(second.style.accentColor, '#22ccff');
  assert.equal(second.style.motion, .8, "the file's track override wins over its project style"); assert.equal(second.style.editor, undefined);
  assert.deepStrictEqual(second.style.look, source.project.style.look); assert.deepStrictEqual(second.style.segmentation, { maxWords: 2 }, 'the track keeps its own density');
  assert.deepStrictEqual(second.roles, source.project.tracks[0].roles); assert.equal(q.techniques.wa, true);
  assert.equal(J.captionResolvedPlan(q.plans[own.id]).entrance, 'captionSoftRise', 'the track is re-planned with the loaded look');
  assert.notEqual(J.captionResolvedPlan(q.plans[q.segments.find(item => item.trackId !== 'track_2').id]).entrance, 'captionSoftRise', 'the other track keeps its look');
  const mid = JSON.stringify(q);
  store.execute({ type: 'apply-caption-style', preset: presetB, trackId: TRACK });
  q = store.project;
  assert.equal(q.tracks[0].style.captionTreatment, 'echo'); assert.equal(q.tracks[0].roles.base.color, '#00ff88');
  assert.equal(q.tracks[1].style.captionTreatment, 'neon', 'the first load stays on its track'); assert.equal(JSON.stringify(q.style), projectStyle);
  assert.equal(q.techniques.wa, true, 'a later file never switches a technique off');
  store.undo(); assert.equal(JSON.stringify(store.project), mid);
  store.undo(); assert.equal(JSON.stringify(store.project), start, 'one undo per load');
  assert.equal(code(() => store.execute({ type: 'apply-caption-style', preset, trackId: 'nope' })), 'TRACK_NOT_FOUND');
}

/* bad files fail loudly */
for (const bad of ['not json', '{}', JSON.stringify({ kind: 'jizura-caption-style', version: 9, style: {} }), JSON.stringify({ kind: 'jizura-caption-style', version: 1 }),
  JSON.stringify({ kind: 'jizura-caption-style', version: 1, style: { preset: 'nope' } }), JSON.stringify({ kind: 'jizura-caption-style', version: 1, style: { look: { enter: 'captionExplode' } } }),
  JSON.stringify({ kind: 'jizura-caption-style', version: 1, style: {}, tracks: [{ id: TRACK, roles: { base: { color: 'red' } } }] })]) {
  assert.equal(code(() => J.parseCaptionStylePreset(bad)), 'CAPTION_STYLE_FILE_INVALID', bad.slice(0, 60));
}
console.log('Caption style file tests passed.');
