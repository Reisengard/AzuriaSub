'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
class Element {
  constructor() { this.listeners = {}; this.style = {}; this.dataset = {}; this.value = ''; this.options = []; this.selectedIndex = -1; this.classList = { toggle() {} }; this.children = []; }
  addEventListener(name, fn) { (this.listeners[name] ||= new Set()).add(fn); }
  removeEventListener(name, fn) { this.listeners[name]?.delete(fn); }
  emit(name, extra = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...extra }); }
  replaceChildren() {}
  setAttribute() {}
  appendChild(child) { return child; }
  insertBefore(child) { return child; }
  remove() {}
  append() {}
  querySelectorAll() { return []; }
  closest() { return null; }
  get childElementCount() { return 0; }
}
// Only for font measurement while the modules load; page elements have no 2D context, so canvas painting is skipped.
class Canvas extends Element { getContext() { return { measureText: text => ({ width: String(text).length * 30 }) }; } }
class Video extends Element {
  constructor() { super(); this.duration = 15; this.videoWidth = 1920; this.videoHeight = 1080; this.currentTime = 0; this.paused = true; }
  load() { if (this.src) queueMicrotask(() => this.emit('loadedmetadata')); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  removeAttribute() { this.src = ''; }
}
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
let previews = 0;
const context = vm.createContext({ console, Uint8Array, Set, Map, queueMicrotask,
  document: { addEventListener() {}, querySelector: selector => el(selector), querySelectorAll: () => [], getElementById: el, createElement: tag => tag === 'video' ? new Video() : tag === 'canvas' ? new Canvas() : new Element() },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  J: {},
  addEventListener() {}
});
context.window = context;
/* The real modules (store, planner, looks, boxes, tracks) so the workbench never runs against a stale hand-made J.
   Left out: the Lyric Motion UI, the product shell and the video editor panel (DOM-heavy, not under test here).
   Only the preview controller is replaced: it needs a real canvas and video frames. */
for (const file of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && !/^(12_ui|11z_product_shell|12a_video_edit_ui|12c_caption_workbench)\.js$/.test(name)).sort()) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
}
context.J.MediaPreviewController = class { constructor(options) { this.video = options.video; } connect() { previews++; return this; } renderNow() {} disconnect() {} };
vm.runInContext(fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8'), context, { filename: '12c_caption_workbench.js' });
const file = { name: 'clip.mp4', type: 'video/mp4', size: 1, lastModified: 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) };
async function select(id, selected) { el(id).files = [selected]; el(id).emit('change'); await new Promise(resolve => setImmediate(resolve)); }
(async () => {
  await select('captionVideoFile', file);
  assert.equal(previews, 1, 'selecting a video must reach preview connection');
  assert.equal(el('captionPreviewEmpty').hidden, true);
  assert.equal(el('captionPlay').disabled, false);
  assert.equal(el('captionDuration').textContent, '00:15.00');
  const video = context.J.captionWorkbench.media.current.video;
  el('captionPlay').emit('click'); assert.equal(video.paused, false);
  el('captionScrub').value = 500; el('captionScrub').emit('input'); assert.equal(video.currentTime, 7.5);
  el('captionSpeed').emit('click'); assert.equal(video.playbackRate, .75); assert.equal(el('captionSpeed').textContent, '0.75×');
  el('captionLoop').emit('click'); assert.equal(el('captionLoop').attrs && el('captionLoop').attrs['aria-pressed'] || 'false', 'false', 'no caption selected and no range marked: loop stays off');
  el('app').emit('jizura:product-mode', { detail: { mode: 'lyric' } }); assert.equal(video.paused, true);
  await select('captionVideoFile', { ...file, type: 'text/plain' });
  assert.match(el('captionStatus').textContent, /not identified as a video/);
  await select('captionVideoFile', file); assert.equal(previews, 2, 'retry must connect preview');
  // A second subtitle file never replaces the first: it lands on a new track, as one undo step.
  const ui = context.J.captionWorkbench, text = (name, body) => ({ name, text: async () => body });
  await select('captionTranscriptFile', text('a.srt', '1\n00:00:01,000 --> 00:00:03,000\nFirst file here\n'));
  const first = JSON.stringify(ui.store.project.segments);
  assert.equal(ui.store.project.tracks.length, 1); assert.ok(ui.store.project.segments.length > 0);
  await select('captionTranscriptFile', text('b.srt', '1\n00:00:01,500 --> 00:00:04,000\nSecond file here\n'));
  const p = ui.store.project, added = p.segments.filter(segment => segment.trackId === 'track_2');
  assert.equal(p.tracks.length, 2); assert.ok(added.length > 0, 'the second file becomes captions on a new track');
  assert.equal(JSON.stringify(p.segments.filter(segment => segment.trackId !== 'track_2')), first, 'the first file is kept as it was');
  assert.ok(p.transcript.tokens.filter(token => added.some(segment => segment.tokenIds.includes(token.id))).every(token => token.timingQuality === 'estimated'));
  assert.match(el('captionStatus').textContent, /新しいトラックに追加しました/);
  assert.ok(ui.store.undo()); assert.equal(ui.store.project.tracks.length, 1); assert.equal(JSON.stringify(ui.store.project.segments), first); assert.ok(ui.store.redo());
  // A style file goes to the chosen track only.
  const style = JSON.stringify({ kind: 'jizura-caption-style', version: 1, style: { preset: 'punchy', captionTreatment: 'neon' }, tracks: [] });
  await select('captionStyleFile', text('style.json', style));
  assert.equal(ui.store.project.tracks.some(track => track.style.captionTreatment), false, 'with several tracks nothing is applied before a track is chosen');
  el('captionStyleTrack').value = 'track_2'; el('captionStyleTrackApply').emit('click');
  assert.equal(ui.store.project.tracks[1].style.captionTreatment, 'neon'); assert.equal(ui.store.project.tracks[0].style.captionTreatment, undefined);
  assert.equal(ui.store.project.style.preset, 'creator', 'the project style is not replaced');
  el('captionNew').emit('click');
  el('captionPlay').emit('click'); el('captionScrub').emit('input');
  assert.equal(context.J.captionWorkbench.media, null);
  console.log('Caption video selection, playback, retry, and reset passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
