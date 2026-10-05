/* ============================================================
   JIZURA — canonical timed text, validation, and import adapters
   ============================================================ */
(() => {
'use strict';

J.TIMED_TEXT_SCHEMA_VERSION = 1;
J.TIMING_QUALITIES = Object.freeze(['word', 'estimated', 'segment']);

const fail = (code, message, details) => {
  if (J.ProjectError) throw new J.ProjectError(code, message, details);
  const error = new Error(message); error.code = code; Object.assign(error, details || {}); throw error;
};
const clone = value => JSON.parse(JSON.stringify(value));
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const pad = value => String(value).padStart(6, '0');

J.normalizeTokenText = text => String(text == null ? '' : text)
  .normalize('NFKC').trim().toLocaleLowerCase().replace(/^\p{P}+|\p{P}+$/gu, '');

const isPunctuation = text => /^[\p{P}\p{S}]+$/u.test(text);
const isCjkLanguage = language => /^(ja|zh|ko)(?:-|$)/i.test(language || '');

/* Returns display tokens. Punctuation remains attached to a neighbouring token,
   while CJK text does not depend on whitespace being present. */
J.tokenizeCaptionText = (text, language = 'und', options = {}) => {
  const source = String(text == null ? '' : text).trim();
  if (!source) return [];
  if (!isCjkLanguage(language) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(source) && /\s/u.test(source)) return source.split(/\s+/u).filter(Boolean);

  let pieces = [];
  if (!options.forceFallback && typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(language === 'und' ? undefined : language, { granularity: 'word' });
    pieces = Array.from(segmenter.segment(source), part => part.segment).filter(part => !/^\s+$/u.test(part));
  } else {
    pieces = isCjkLanguage(language) ? Array.from(source).filter(part => !/^\s$/u.test(part)) : source.split(/\s+/u);
  }
  const tokens = [];
  for (const piece of pieces) {
    if (isPunctuation(piece) && tokens.length) tokens[tokens.length - 1] += piece;
    else tokens.push(piece);
  }
  return tokens.filter(Boolean);
};

J.canonicalToken = (token, index, defaults = {}) => {
  const text = String(token && token.text != null ? token.text : '');
  const id = token && typeof token.id === 'string' && token.id ? token.id : `${defaults.idPrefix || 'word'}_${pad(index + 1)}`;
  return {
    id,
    text,
    normalizedText: token && typeof token.normalizedText === 'string' ? token.normalizedText : J.normalizeTokenText(text),
    start: Number(token && token.start),
    end: Number(token && token.end),
    confidence: token && token.confidence != null ? Number(token.confidence) : null,
    source: String((token && token.source) || defaults.source || 'import'),
    timingQuality: (token && token.timingQuality) || defaults.timingQuality || 'word',
    speakerId: token && token.speakerId != null ? String(token.speakerId) : null,
    emphasis: plainObject(token && token.emphasis) ? clone(token.emphasis) : { score: 0, reasons: [] },
    manualEmphasis: token && token.manualEmphasis != null ? clone(token.manualEmphasis) : null,
  };
};

J.validateTranscript = (transcript, options = {}) => {
  if (!plainObject(transcript)) fail('TRANSCRIPT_NOT_OBJECT', 'Transcript data must be an object.');
  if (transcript.schemaVersion != null && transcript.schemaVersion !== J.TIMED_TEXT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_TRANSCRIPT_SCHEMA_VERSION', `Transcript schema version ${transcript.schemaVersion} is not supported.`, { schemaVersion: transcript.schemaVersion });
  }
  if (!J.TIMING_QUALITIES.includes(transcript.timingQuality)) {
    fail('TIMING_QUALITY_INVALID', `Transcript timingQuality "${String(transcript.timingQuality)}" is invalid.`);
  }
  if (!Array.isArray(transcript.tokens)) fail('TRANSCRIPT_TOKENS_REQUIRED', 'Transcript tokens must be an array.');
  const ids = new Set();
  // Spoken words may not overlap within one track (ADR 0010). Without segments there is one shared lane (the old rule).
  const owners = new Map();
  if (Array.isArray(options.segments)) for (const segment of options.segments) for (const id of segment && segment.tokenIds || []) if (!owners.has(id)) owners.set(id, segment.trackId || (J.CAPTION_PRIMARY_TRACK_ID || ''));
  const previousByLane = new Map();
  for (let index = 0; index < transcript.tokens.length; index++) {
    const token = transcript.tokens[index];
    const tokenId = token && token.id;
    if (!plainObject(token) || typeof tokenId !== 'string' || !tokenId) fail('TOKEN_ID_REQUIRED', `Token at index ${index} requires an id.`, { tokenIndex: index });
    if (ids.has(tokenId)) fail('TOKEN_ID_DUPLICATE', `Token id "${tokenId}" is duplicated.`, { tokenId, tokenIndex: index });
    ids.add(tokenId);
    if (typeof token.text !== 'string' || !token.text) fail('TOKEN_TEXT_REQUIRED', `Token "${tokenId}" requires display text.`, { tokenId, tokenIndex: index });
    if (!Number.isFinite(token.start)) fail('TOKEN_START_INVALID', `Token "${tokenId}" has an invalid start time.`, { tokenId, tokenIndex: index });
    if (token.start < 0) fail('TOKEN_START_NEGATIVE', `Token "${tokenId}" starts before zero.`, { tokenId, tokenIndex: index, start: token.start });
    if (!Number.isFinite(token.end)) fail('TOKEN_END_INVALID', `Token "${tokenId}" has an invalid end time.`, { tokenId, tokenIndex: index });
    if (token.end < token.start) fail('TOKEN_END_BEFORE_START', `Token "${tokenId}" ends before it starts.`, { tokenId, tokenIndex: index, start: token.start, end: token.end });
    if (Number.isFinite(options.duration) && token.end > options.duration + 1e-9) {
      fail('TOKEN_END_AFTER_DURATION', `Subtitle ends at ${token.end.toFixed(2)}s, beyond the video duration (${options.duration.toFixed(2)}s).`, { tokenId, tokenIndex: index, end: token.end, duration: options.duration });
    }
    // Spoken words never overlap on the same track. Words of a manual text block (source "manual") may overlap speech or other
    // blocks: they live on their own track, and the store keeps one caption per track on screen (ADR 0007, ADR 0010).
    const typed = token.source === 'manual';
    // ignoreUnowned: a planner call on a partial project (one caption planned alone) cannot see every word's track.
    const skip = options.segments && options.ignoreUnowned === true && !owners.has(tokenId);
    const lane = options.segments ? (owners.get(tokenId) || J.CAPTION_PRIMARY_TRACK_ID || '') : '';
    const previous = previousByLane.get(lane) || null;
    if (!typed && !skip && previous && token.start < previous.end) {
      fail('TOKEN_TIMING_OVERLAP', `Token "${tokenId}" overlaps "${previous.id}".`, { tokenId, previousTokenId: previous.id, tokenIndex: index });
    }
    if (!J.TIMING_QUALITIES.includes(token.timingQuality)) fail('TOKEN_TIMING_QUALITY_INVALID', `Token "${tokenId}" has invalid timing quality.`, { tokenId, tokenIndex: index });
    if (token.confidence != null && (!Number.isFinite(token.confidence) || token.confidence < 0 || token.confidence > 1)) {
      fail('TOKEN_CONFIDENCE_INVALID', `Token "${tokenId}" confidence must be between 0 and 1.`, { tokenId, tokenIndex: index });
    }
    if (!typed && !skip) previousByLane.set(lane, token);
  }
  return transcript;
};

J.importWordJson = (input, options = {}) => {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch (error) { fail('TRANSCRIPT_JSON_INVALID', `Transcript JSON is invalid: ${error.message}`); }
  }
  if (!plainObject(parsed)) fail('TRANSCRIPT_NOT_OBJECT', 'Transcript data must be an object.');
  if (parsed.schemaVersion !== J.TIMED_TEXT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_TRANSCRIPT_SCHEMA_VERSION', `Transcript schema version ${parsed.schemaVersion} is not supported.`, { schemaVersion: parsed.schemaVersion });
  }
  const result = {
    schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION,
    language: String(parsed.language || options.language || 'und'),
    timingQuality: 'word',
    tokens: (parsed.tokens || []).map((token, index) => J.canonicalToken(token, index, { source: options.source || 'word-json', timingQuality: 'word' })),
  };
  J.validateTranscript(result, { duration: options.duration });
  return result;
};

const parseTimestamp = value => {
  const match = String(value).trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  return match ? +(Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000).toFixed(3) : NaN;
};

J.importSubtitleText = (input, options = {}) => {
  const format = String(options.format || '').toLowerCase();
  if (format !== 'srt' && format !== 'vtt') fail('SUBTITLE_FORMAT_REQUIRED', 'Subtitle format must be explicitly set to "srt" or "vtt".');
  if (options.timingQuality !== 'estimated') fail('ESTIMATED_TIMING_REQUIRED', 'Cue-level subtitle imports require timingQuality "estimated".');
  const language = String(options.language || 'und');
  const rows = String(input || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  const cues = [];
  for (let index = 0; index < rows.length; index++) {
    const timing = rows[index].match(/^\s*([^\s]+)\s+-->\s+([^\s]+)(?:\s+.*)?$/);
    if (!timing) continue;
    const start = parseTimestamp(timing[1]), end = parseTimestamp(timing[2]);
    const text = [];
    while (++index < rows.length && rows[index].trim()) text.push(rows[index].trim());
    cues.push({ start, end, text: text.join(' ') });
  }
  const tokens = [];
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    const cue = cues[cueIndex];
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end < cue.start) {
      fail('SUBTITLE_CUE_TIMING_INVALID', `Subtitle cue ${cueIndex + 1} has invalid timing.`, { cueIndex });
    }
    const words = J.tokenizeCaptionText(cue.text, language, options);
    const weights = words.map(word => Math.max(1, Array.from(J.normalizeTokenText(word) || word).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = cue.start;
    words.forEach((word, wordIndex) => {
      const end = wordIndex === words.length - 1 ? cue.end : cursor + (cue.end - cue.start) * weights[wordIndex] / totalWeight;
      tokens.push(J.canonicalToken({
        id: `cue_${pad(cueIndex + 1)}_word_${String(wordIndex + 1).padStart(3, '0')}`,
        text: word, start: +cursor.toFixed(6), end: +end.toFixed(6), timingQuality: 'estimated', source: options.source || format,
      }, tokens.length, { timingQuality: 'estimated', source: options.source || format }));
      cursor = end;
    });
  }
  if (!tokens.length) fail('TRANSCRIPT_EMPTY', 'No captions were found. Choose an SRT/VTT file containing timestamps and subtitle text.');
  const result = { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language, timingQuality: 'estimated', tokens };
  J.validateTranscript(result, { duration: options.duration });
  return result;
};

J.importSrt = (input, options = {}) => J.importSubtitleText(input, Object.assign({}, options, { format: 'srt' }));
J.importVtt = (input, options = {}) => J.importSubtitleText(input, Object.assign({}, options, { format: 'vtt' }));

/* ---------- subtitle export ---------- */
/* One line of cue text: words joined by a space, except between two Japanese / Chinese characters. A blank line would end the cue. */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿ー＀-￯]/u;
const cueText = words => {
  let text = '';
  for (const word of words.map(word => String(word == null ? '' : word).replace(/\s+/gu, ' ').trim()).filter(Boolean)) {
    const glued = text && CJK_CHAR.test(Array.from(text).pop()) && CJK_CHAR.test(Array.from(word)[0]);
    text += (text && !glued ? ' ' : '') + word;
  }
  return text;
};

/* Cues on the edited timeline, the one the exported MP4 plays on. Caption times are source times: each caption is cut to the
   kept sections and moved by the length removed before it; a caption that lies wholly in removed material is left out.
   Kept sections play back to back, so the parts of a caption that crosses a cut stay one cue. All tracks, in start order. */
J.subtitleCues = project => {
  const tokens = new Map((project.transcript && project.transcript.tokens || []).map(token => [token.id, token]));
  const kept = J.videoEditSettings ? J.videoEditSettings(project).clips || [] : [];
  const clips = kept.length ? kept : [{ start: 0, end: Infinity }];
  const cues = [];
  (project.segments || []).forEach((segment, order) => {
    const text = cueText((segment.tokenIds || []).map(id => tokens.get(id)).filter(Boolean).map(token => token.text));
    if (!text) return;
    let offset = 0, start = null, end = null;
    for (const clip of clips) {
      const from = Math.max(segment.start, clip.start), to = Math.min(segment.end, clip.end);
      if (to > from) { if (start == null) start = offset + from - clip.start; end = offset + to - clip.start; }
      offset += clip.end - clip.start;
    }
    if (start != null) cues.push({ start, end, text, order });
  });
  return cues.sort((a, b) => a.start - b.start || a.order - b.order).map(cue => ({ start: cue.start, end: cue.end, text: cue.text }));
};

const two = value => String(value).padStart(2, '0');
const srtTimestamp = ms => `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;

J.exportSubtitleText = (project, options = {}) => {
  const format = String(options.format || '').toLowerCase();
  if (format !== 'srt') fail('SUBTITLE_FORMAT_REQUIRED', 'Subtitle export format must be explicitly set to "srt".');
  const cues = J.subtitleCues(project);
  if (!cues.length) fail('SUBTITLE_EXPORT_EMPTY', 'There are no captions in the exported part of the video.');
  // Times are rounded only here; a cue shorter than a millisecond still gets one.
  return cues.map((cue, index) => {
    const start = Math.max(0, Math.round(cue.start * 1000)), end = Math.max(start + 1, Math.round(cue.end * 1000));
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${cue.text}\n`;
  }).join('\n');
};
J.exportSrt = project => J.exportSubtitleText(project, { format: 'srt' });
})();
