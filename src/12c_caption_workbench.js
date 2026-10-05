/* ============================================================
   JIZURA — Video Captions workbench: bootstrap: project, media, import and export wiring
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, clone, fmt, status, selectedSegment, segmentTrackId, sourceVideo, runCommand, on, emit } = W;
const projectId = () => `caption_${Date.now().toString(36)}`;
function emptyProject() {
  const now = new Date().toISOString();
  return { schemaVersion: J.PROJECT_SCHEMA_VERSION, generatorVersion: J.PROJECT_GENERATOR_VERSION,
    mode: 'video-captions', id: projectId(), media: {},
    transcript: { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language: 'und', timingQuality: 'word', tokens: [] },
    tracks: [J.defaultCaptionTrack({ media: {} })], guides: [], segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator', intensity: .5, motion: .45, accentColor: '#f5a50c', editor: 'simple' },
    settings: {}, createdAt: now, updatedAt: now };
}

function setProject(project, keepSelection) {
  ui.store = new J.CaptionStore(project);
  if (!keepSelection || !ui.store.project.segments.some(segment => segment.id === ui.selectedId)) ui.selectedId = ui.store.project.segments[0] && ui.store.project.segments[0].id || null;
  emit('project');
}

function renderActions() {
  const hasTranscript = ui.store.project.transcript.tokens.length > 0;
  $('captionUndo').disabled = !ui.store.canUndo(); $('captionRedo').disabled = !ui.store.canRedo();
  $('captionVariation').disabled = !hasTranscript; $('captionSave').disabled = !(hasTranscript || sourceVideo() || ui.store.project.settings.videoEdit);
  $('captionExport').disabled = $('captionExportPanel').disabled = ui.exportAbort ? false : !sourceVideo();
  $('captionExportQuality').disabled = !!ui.exportAbort;
  $('captionExportPanel').textContent = ui.exportAbort ? 'キャンセル' : '書き出しを開始';
  const out = J.videoOutputSize ? J.videoOutputSize(ui.store.project) : null;
  $('captionExportFormat').textContent = out ? `${out.width} × ${out.height}` : '—';
  $('captionExportDuration').textContent = fmt(J.videoEditDuration(J.videoClips(ui.store.project)));
  $('captionExportCaptions').textContent = String(ui.store.project.segments.length);
}

/* Runs before / after every panel's own 'project' handler. */
function beforeProject() {
  if (ui.selectedId && !ui.store.project.segments.some(segment => segment.id === ui.selectedId)) ui.selectedId = ui.store.project.segments[0] && ui.store.project.segments[0].id || null;
  if (!(ui.store.project.tracks || []).some(track => track.id === ui.trackId)) ui.trackId = segmentTrackId(selectedSegment());
  if (ui.videoEditor) ui.videoEditor.refresh();
  if (J.preloadVideoOverlays) J.preloadVideoOverlays(ui.store.project, () => { if (ui.preview) ui.preview.renderNow(); });   // no-op once decoded
  if (ui.preview && J.videoOutputSize) { const size = J.videoOutputSize(ui.store.project); ui.preview.designWidth = size.width; ui.preview.designHeight = size.height; }
  fitPreviewFrame();
}
function afterProject() {
  renderActions(); W.updatePlayhead(sourceVideo() && sourceVideo().currentTime || 0); if (ui.preview) ui.preview.renderNow();
}

/* The preview frame is the largest rectangle of the output aspect that fits the stage; the drawer and the timeline strip take their own space first. */
function fitPreviewFrame() {
  const view = $('captionStageView'), frame = $('captionPreviewFrame');
  if (!view || !frame || !frame.style || !(view.clientWidth > 0 && view.clientHeight > 0)) return;
  const out = J.videoOutputSize ? J.videoOutputSize(ui.store.project) : { width: 1080, height: 1920 }, ratio = out.width / out.height;
  let width = view.clientWidth, height = width / ratio;
  if (height > view.clientHeight) { height = view.clientHeight; width = height * ratio; }
  frame.style.width = `${Math.max(1, Math.floor(width))}px`; frame.style.height = `${Math.max(1, Math.floor(height))}px`;
}
function onWorkbenchResize() { fitPreviewFrame(); if (ui.preview) ui.preview.renderNow(); W.paintBoxEditor(); W.paintToolbar(); }
function drawCaptions(ctx, time, info) {
  return J.drawCaptionOverlay(ctx, ui.store.project, time, Object.assign({}, info, { reducedMotion: !!ui.store.project.settings.reducedMotionPreview }));
}
/* Export is a dialog: format, length, caption count, progress, cancel. The top-bar button only opens it; its own button starts or cancels. */
function exportState(text, fraction, isError) {
  const state = $('captionExportState'), bar = $('captionExportProgress');
  state.textContent = text || ''; state.classList.toggle('error', !!isError);
  bar.hidden = fraction == null; if (fraction != null) bar.value = Math.max(0, Math.min(1, fraction));
}
function openExportDialog() {
  renderActions();
  const dialog = $('captionExportDlg'); if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
}
async function exportCaptions() {
  if (ui.exportAbort) { ui.exportAbort.abort(); status('書き出しをキャンセルしています…'); exportState('書き出しをキャンセルしています…'); return; }
  const current = ui.media && ui.media.current; if (!current) return;
  let writable = null;
  try {
    if (typeof window.showSaveFilePicker === 'function') { const handle = await window.showSaveFilePicker({ suggestedName: `jizura-${ui.store.project.id}.mp4`,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] }); writable = await handle.createWritable(); }
  } catch (error) { if (error && error.name === 'AbortError') return; throw error; }
  ui.exportAbort = new AbortController(); ui.exporter = new J.CaptionVideoExporter(); exportState('書き出しを準備しています…', 0); $('captionExport').textContent = '書き出し中…'; $('captionExport').disabled = $('captionExportPanel').disabled = false; renderActions();
  try {
    const result = await ui.exporter.export(current.file, clone(ui.store.project), { writable, quality: $('captionExportQuality').value, signal: ui.exportAbort.signal,
      onProgress: event => { const labels = { checking: '書き出し環境を確認中', video: '字幕付き映像を書き出し中', audio: '元の音声を保持中', finalizing: 'MP4を仕上げています' };
        const line = `${labels[event.phase] || '書き出し中'}… ${Math.round(event.progress * 100)}%`; status(line); exportState(line, event.progress); } });
    if (result.blob) await J.saveFile(`jizura-${ui.store.project.id}.mp4`, result.blob);
    const done = `書き出しました（${result.frameCount}フレーム・音声${result.audio.mode !== 'none' ? '保持' : 'なし'}・${result.metrics.elapsedSeconds.toFixed(1)}秒）。`; status(done); exportState(done, 1);
  } catch (error) { const recovery = J.recoveryForError ? J.recoveryForError(error) : { display: error.message || '書き出しに失敗しました。' };
    const cancelled = error.code === 'MEDIA_EXPORT_CANCELLED', text = cancelled ? '書き出しをキャンセルしました。' : recovery.display; status(text, !cancelled); exportState(text, null, !cancelled); }
  finally { ui.exportAbort = null; ui.exporter = null; $('captionExport').textContent = '書き出し'; renderActions(); }
}
async function importVideo(file, expectedMedia) {
  status(expectedMedia ? '動画を照合しています…' : '動画を読み込んでいます…');
  if (!ui.media) ui.media = new J.MediaSourceController();
  if (ui.preview) { ui.preview.disconnect(); ui.preview = null; }
  let loaded;
  try { loaded = expectedMedia ? await ui.media.relink([file], expectedMedia) : await ui.media.load([file]); }
  catch (error) { if (expectedMedia && error.code === 'MEDIA_RELINK_MISMATCH') { $('captionRelinkNotice').hidden = false; status('選択した動画は、このプロジェクトの元動画と一致しません。', true); } throw error; }
  const project = clone(ui.store.project), frozenPlans = JSON.stringify(project.plans); project.media = loaded.projectMedia;
  // An untouched default box follows the new frame; a box the user edited stays exactly as set.
  if (!expectedMedia) { J.captionSyncDefaultBoxes(project); J.captionSyncTrackBoxes(project); }
  setProject(project, true); $('captionMediaName').textContent = `${loaded.metadata.name} · ${loaded.metadata.width}×${loaded.metadata.height}`;
  if (expectedMedia && JSON.stringify(ui.store.project.plans) !== frozenPlans) throw new Error('Relinking changed frozen caption plans.');
  $('captionRelinkNotice').hidden = true; $('captionPreviewEmpty').hidden = true; $('captionPlay').disabled = false; $('captionScrub').disabled = false;
  ui.preview = new J.MediaPreviewController({ video: loaded.video, canvas: $('captionPreview'), designWidth: J.videoOutputSize(project).width, designHeight: J.videoOutputSize(project).height, constrainAspect: true,
    renderSource: (ctx, source, width, height) => J.drawVideoEdit(ctx, source, width, height, ui.store.project),
    renderCaptions: drawCaptions, onFrame: frame => {
      W.updatePlayhead(frame.mediaTime);
      W.alignPreviewZone();
      if (ui.videoEditor) ui.videoEditor.paint();
      W.skipCuts(frame, loaded.video);
    },
    onError: error => status(error.message || 'Video preview could not render a frame.', true) }).connect();
  W.attachVideo(loaded.video);
  W.loadWaveform(file, Number(project.media.duration) || Number(loaded.video.duration) || 0);
  status('動画を読み込みました。文字起こしを追加できます。');
}

async function openProject(file) {
  status('プロジェクトを開いています…');
  const loaded = J.loadProject(await file.text());
  if (loaded.mode !== 'video-captions') { const error = new Error('Video Captions プロジェクトを選んでください。'); error.code = 'CAPTION_PROJECT_REQUIRED'; throw error; }
  if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); ui.preview = null; ui.media = null; ui.selectedId = null; W.clearWaveform();
  setProject(loaded); $('captionProjectName').value = file.name.replace(/\.json$/i, '') || loaded.id;
  const needsRelink = !!(loaded.media && (loaded.media.fingerprint || loaded.media.relinkRequired));
  $('captionRelinkNotice').hidden = !needsRelink; $('captionPreviewEmpty').hidden = false; $('captionPlay').disabled = true; $('captionScrub').disabled = true;
  $('captionMediaName').textContent = needsRelink ? `${loaded.media.name || '元動画'} · 再リンクが必要` : '動画未選択';
  status(needsRelink ? 'プロジェクトを開きました。元の動画を再リンクしてください。' : 'プロジェクトを開きました。');
}

function applyTranscript(transcript) {
  const duration = ui.store.project.media.duration;
  const project = clone(ui.store.project); project.transcript = transcript;
  project.segments = J.segmentCaptions(transcript, { duration }).segments;
  const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans; project.updatedAt = new Date().toISOString();
  setProject(project); status(`${project.segments.length}件の字幕を作成しました。`);
}
async function importTranscript(file) {
  const text = await file.text(), ext = file.name.toLowerCase().split('.').pop(), duration = ui.store.project.media.duration;
  applyTranscript(ext === 'srt' ? J.importSrt(text, { timingQuality: 'estimated', duration }) : ext === 'vtt' ? J.importVtt(text, { timingQuality: 'estimated', duration }) : J.importWordJson(text, { duration }));
}

/* AI transcription (ADR 0011): the soundtrack goes to the Gemini API with the user's own key, and only when they start it.
   The result is word JSON and enters through the same path as an imported transcript file. */
const TRANSCRIBE_KEY = 'jizura.geminiKey', TRANSCRIBE_LANG = 'jizura.transcribeLang';
const transcribeError = (code, message) => Object.assign(new Error(message), { code });
function transcribeState(text, isError) { const state = $('captionTranscribeState'); state.textContent = text || ''; state.classList.toggle('error', !!isError); }
function openTranscribeDialog() {
  let key = '', lang = null;
  try { key = localStorage.getItem(TRANSCRIBE_KEY) || ''; lang = localStorage.getItem(TRANSCRIBE_LANG); } catch (_) { /* storage blocked */ }
  if (!$('captionTranscribeKey').value) $('captionTranscribeKey').value = key;
  if (lang == null) lang = /^ja/i.test(document.documentElement.lang || '') ? 'ja-JP' : '';
  if ($('captionTranscribeLang').querySelector(`option[value="${lang}"]`)) $('captionTranscribeLang').value = lang;
  if (!ui.transcribeAbort) transcribeState(sourceVideo() ? '' : '先に動画を読み込んでください。');
  const dialog = $('captionTranscribeDlg'); if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
}
/* The soundtrack as 16 kHz mono WAV: small enough to send inline, and all a speech model needs. */
async function videoAudioWav(file) {
  const Context = window.AudioContext || window.webkitAudioContext, Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let context, decoded;
  try { context = new Context(); decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  catch (error) { throw transcribeError('TRANSCRIBE_AUDIO_UNREADABLE', 'The audio of this video could not be read.'); }
  finally { try { context && context.close(); } catch (error) {} }
  const rate = J.TRANSCRIBE_SAMPLE_RATE, offline = new Offline(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const node = offline.createBufferSource(); node.buffer = decoded; node.connect(offline.destination); node.start();
  return J.encodeWavPcm16((await offline.startRendering()).getChannelData(0), rate);
}
async function transcribeVideo() {
  if (ui.transcribeAbort) { ui.transcribeAbort.abort(); return; }
  const current = ui.media && ui.media.current; if (!current) { transcribeState('先に動画を読み込んでください。', true); return; }
  const apiKey = $('captionTranscribeKey').value.trim(), languageCode = $('captionTranscribeLang').value, duration = Number(ui.store.project.media.duration) || 0;
  if (ui.store.project.segments.length && !window.confirm('今ある字幕はすべて置き換えられます。続けますか？')) return;
  const abort = ui.transcribeAbort = new AbortController(); $('captionTranscribeStart').textContent = 'キャンセル';
  try {
    if (!apiKey) throw transcribeError('TRANSCRIBE_KEY_REQUIRED', 'A Gemini API key is required.');
    if (duration > J.TRANSCRIBE_MAX_SECONDS) throw transcribeError('TRANSCRIBE_AUDIO_TOO_LONG', 'This video is too long for automatic transcription.');
    try { localStorage.setItem(TRANSCRIBE_KEY, apiKey); localStorage.setItem(TRANSCRIBE_LANG, languageCode); } catch (_) { /* storage blocked */ }
    transcribeState('音声を準備しています…');
    const wav = await videoAudioWav(current.file);
    if (abort.signal.aborted) throw transcribeError('TRANSCRIBE_CANCELLED', 'Transcription was cancelled.');
    transcribeState('文字起こし中…（1分ほどかかることがあります）');
    const words = await J.transcribeAudio(wav, { apiKey, languageCode, language: J.TRANSCRIBE_LANGUAGES[languageCode] || 'und', duration: duration || undefined, signal: abort.signal });
    if (!ui.media || ui.media.current !== current) throw transcribeError('TRANSCRIBE_CANCELLED', 'Transcription was cancelled.');   // another video was loaded meanwhile
    applyTranscript(J.importWordJson(words, { duration: duration || undefined, source: 'gemini' }));
    transcribeState(`${ui.store.project.segments.length}件の字幕を作成しました。`);
    const dialog = $('captionTranscribeDlg'); if (dialog.close && dialog.open) dialog.close();
  } catch (error) {
    const cancelled = error.code === 'TRANSCRIBE_CANCELLED', text = cancelled ? '文字起こしをキャンセルしました。' : J.recoveryForError ? J.recoveryForError(error).display : error.message;
    transcribeState(text, !cancelled); status(text, !cancelled);
  } finally { ui.transcribeAbort = null; $('captionTranscribeStart').textContent = '文字起こしを開始'; }
}

function projectFileStem() { return $('captionProjectName').value.trim().replace(/[\/:*?"<>|]+/g, '-') || `jizura-${ui.store.project.id}`; }

function bind() {
  $('captionProjectName').addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
  $('captionProjectName').addEventListener('blur', event => { if (!event.target.value.trim()) event.target.value = '無題の字幕プロジェクト'; });
  setProject(emptyProject());
  $('captionVideoFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) importVideo(file).catch(error => { if (error.code !== 'MEDIA_RELINK_MISMATCH') status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }); event.target.value = ''; });
  $('captionRelinkFile').addEventListener('change', event => { const file = event.target.files[0], expected = clone(ui.store.project.media); if (file) importVideo(file, expected).catch(error => { if (error.code !== 'MEDIA_RELINK_MISMATCH') status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }); event.target.value = ''; });
  $('captionProjectFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) openProject(file).catch(error => status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true)); event.target.value = ''; });
  $('captionTranscriptFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) importTranscript(file).catch(error => status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true)); event.target.value = ''; });
  $('captionTranscribeOpen').addEventListener('click', openTranscribeDialog);
  $('captionTranscribeStart').addEventListener('click', () => { transcribeVideo(); });
  $('captionTranscribeKey').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); transcribeVideo(); } });
  $('captionTranscribeForget').addEventListener('click', () => { try { localStorage.removeItem(TRANSCRIBE_KEY); } catch (_) { /* storage blocked */ } $('captionTranscribeKey').value = ''; transcribeState('保存したキーを消しました。'); });
  $('captionUndo').addEventListener('click', () => { if (ui.store.undo()) emit('project'); }); $('captionRedo').addEventListener('click', () => { if (ui.store.redo()) emit('project'); });
  $('captionVariation').addEventListener('click', () => { if (runCommand({ type: 'randomize-caption-look', variation: ++ui.variation })) status('全体のエフェクトをランダムに決めました。元に戻すで戻せます。'); });
  $('captionSave').addEventListener('click', () => J.saveFile(`${projectFileStem()}.json`, ui.store.serialize()));
  $('captionStyleSave').addEventListener('click', () => { J.saveFile('jizura-caption-style.json', JSON.stringify(J.captionStylePreset(ui.store.project), null, 1)); status('スタイルを保存しました。'); });
  $('captionStyleFile').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      const preset = J.parseCaptionStylePreset(await file.text());
      if (runCommand({ type: 'apply-caption-style', preset }, ui.selectedId)) {
        if (J.ensureCaptionFonts) J.ensureCaptionFonts(ui.store.project).then(() => { if (ui.preview) ui.preview.renderNow(); W.renderRolesPanel(); }).catch(() => {});
        status('スタイルを読み込みました。元に戻すで戻せます。');
      }
    } catch (error) { status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }
  });
  $('captionExport').addEventListener('click', openExportDialog);
  try { const saved = localStorage.getItem('jizura.exportQuality'); if (saved && $('captionExportQuality').querySelector(`option[value="${saved}"]`)) $('captionExportQuality').value = saved; } catch (_) { /* storage blocked */ }
  $('captionExportQuality').addEventListener('change', event => { try { localStorage.setItem('jizura.exportQuality', event.target.value); } catch (_) { /* storage blocked */ } });
  $('captionExportPanel').addEventListener('click', () => exportCaptions().catch(error => { status(error.message, true); exportState(error.message, null, true); }));
  $('captionNew').addEventListener('click', () => { if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); ui.media = null; ui.preview = null; ui.selectedId = null; W.clearWaveform(); setProject(emptyProject()); $('captionProjectName').value = '無題の字幕プロジェクト'; $('captionRelinkNotice').hidden = true; $('captionPreviewEmpty').hidden = false; $('captionMediaName').textContent = '動画未選択'; $('captionPlay').disabled = true; $('captionScrub').disabled = true; status('新しいプロジェクトを作成しました。'); });
  $('captionHelp').addEventListener('click', () => { const dialog = $('captionHelpDlg'); if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', ''); });
  window.addEventListener('resize', onWorkbenchResize);
  if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(onWorkbenchResize); observer.observe($('captionStageView')); }   // strip height changes with the track count
  $('app').addEventListener('jizura:product-mode', event => {
    if (event.detail.mode === 'video-captions') fitPreviewFrame();
    if (!sourceVideo()) return;
    if (event.detail.mode !== 'video-captions') sourceVideo().pause();
    else if (ui.preview) ui.preview.renderNow();
  });
  window.addEventListener('beforeunload', () => { if (ui.exportAbort) ui.exportAbort.abort(); if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); });

}
const captionSetTechnique = J.CaptionStore.prototype.setTechnique;
J.CaptionStore.prototype.setTechnique = function (command) {
  captionSetTechnique.call(this, command);
  if (command.group && J.CAPTION_TECHNIQUE_DRAW[command.group] === true && this.project.transcript.tokens.length) {
    this.project.plans = J.planCaptions(this.project, this.project.media).plans;
  }
};

Object.assign(W, { afterProject, beforeProject, drawCaptions, emptyProject, applyTranscript, exportCaptions, exportState, fitPreviewFrame, importTranscript, transcribeVideo, importVideo, onWorkbenchResize, openExportDialog, openProject, projectId, renderActions, setProject });
on('project', beforeProject, -10); on('project', afterProject, 10);

/* The single-file build places scripts after the complete body. Initializing
   here avoids depending on listener ordering with the preserved lyric UI. */
for (const init of W.inits) init();
bind();
if (J.mountVideoEditor) ui.videoEditor = J.mountVideoEditor({ host: $('captionVideoEditor'), project: () => ui.store.project, video: sourceVideo,
  commit: value => runCommand({ type: 'set-video-edits', value }), status });
J.captionWorkbench = ui;
})();
