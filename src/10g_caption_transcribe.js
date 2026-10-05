/* ============================================================
   JIZURA — hosted transcription adapter (Gemini 3.5 Transcribe) -> word-timestamp JSON
   Opt-in: the audio leaves the browser only when the user starts it with their own API key (ADR 0011).
   The adapter emits the word JSON J.importWordJson already reads, so schema and planner stay provider-independent.
   ============================================================ */
(() => {
'use strict';

J.TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
J.TRANSCRIBE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
J.TRANSCRIBE_SAMPLE_RATE = 16000;
/* Inline audio: the whole request may be 20 MB. 16 kHz mono PCM16 is 32 kB/s, base64 adds a third: 7 minutes is 17.9 MB. */
J.TRANSCRIBE_MAX_SECONDS = 420;
J.TRANSCRIBE_LANGUAGES = Object.freeze({ '': 'und', 'ja-JP': 'ja', 'en-US': 'en', 'ko-KR': 'ko', 'cmn-Hans-CN': 'zh-Hans', 'yue-Hant-HK': 'zh-Hant' });

const fail = (code, message, details) => {
  if (J.ProjectError) throw new J.ProjectError(code, message, details);
  const error = new Error(message); error.code = code; Object.assign(error, details || {}); throw error;
};
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const punctuationOnly = text => /^[\p{P}\p{S}]+$/u.test(text);

/* Mono Float32 samples -> a 16-bit PCM WAV file (Uint8Array). */
J.encodeWavPcm16 = (samples, sampleRate) => {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]) || 0);
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return bytes;
};

J.bytesToBase64 = bytes => {
  if (typeof btoa !== 'function') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

/* The Interactions API request body. Word timestamps need verbatim mode; store:false keeps the request out of Google's interaction log. */
J.transcribeRequest = (audioBase64, options = {}) => ({
  model: options.model || J.TRANSCRIBE_MODEL,
  input: [{ type: 'audio', data: audioBase64, mime_type: options.mimeType || 'audio/wav' }],
  generation_config: { transcription_config: {
    language_codes: options.languageCode ? [options.languageCode] : [],
    mode: { type: 'verbatim', timestamp_granularities: ['word'] },
  } },
  store: false,
});

const offsetSeconds = value => {
  if (typeof value === 'number') return value;
  const match = String(value == null ? '' : value).trim().match(/^(\d+(?:\.\d+)?)s?$/);
  return match ? Number(match[1]) : NaN;
};

/* A completed interaction -> word JSON (schemaVersion 1). The provider's times are repaired, never trusted:
   words are kept in spoken order, may not overlap, and stay inside the video. A "word" that holds several
   Japanese words is split again with the app's own tokenizer, its time shared out by character count. */
J.transcribeResponseToWordJson = (response, options = {}) => {
  const language = String(options.language || 'und'), duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : Infinity;
  const words = [];
  for (const step of response && response.steps || []) for (const content of step && step.content || []) for (const annotation of content && content.annotations || []) {
    if (annotation && annotation.type === 'word_info') words.push(annotation);
  }
  const tokens = [];
  let cursor = 0;
  for (const word of words) {
    const text = String(word.text == null ? '' : word.text).trim();
    let start = offsetSeconds(word.start_offset), end = offsetSeconds(word.end_offset);
    if (!text || !Number.isFinite(start)) continue;
    if (punctuationOnly(text)) { if (tokens.length) tokens[tokens.length - 1].text += text; continue; }
    if (!Number.isFinite(end)) end = start;
    start = Math.min(duration, Math.max(cursor, start)); end = Math.min(duration, Math.max(start, end));
    const pieces = CJK.test(text) ? J.tokenizeCaptionText(text, language) : [text];
    const weights = pieces.map(piece => Math.max(1, Array.from(J.normalizeTokenText(piece) || piece).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let at = start;
    pieces.forEach((piece, index) => {
      const pieceEnd = index === pieces.length - 1 ? end : at + (end - start) * weights[index] / total;
      tokens.push({ text: piece, start: +at.toFixed(3), end: +Math.max(at, pieceEnd).toFixed(3) });
      at = pieceEnd;
    });
    cursor = end;
  }
  // Rounding to milliseconds must not create an overlap or an inverted word.
  for (let index = 0; index < tokens.length; index++) {
    if (index && tokens[index].start < tokens[index - 1].end) tokens[index].start = tokens[index - 1].end;
    if (tokens[index].end < tokens[index].start) tokens[index].end = tokens[index].start;
  }
  if (!tokens.length) fail('TRANSCRIBE_EMPTY', 'The transcription returned no timed words.');
  return { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language, tokens };
};

/* An error for a failed request: `body` is the parsed JSON error body when there is one. */
J.transcribeHttpError = (status, body) => {
  const info = Array.isArray(body) ? body[0] && body[0].error : body && body.error;
  const detail = info && info.message ? String(info.message) : `HTTP ${status}`;
  const reason = info && (info.details || []).map(item => item && item.reason).find(Boolean) || info && info.status || '';
  const code = reason === 'API_KEY_INVALID' || status === 401 || status === 403 ? 'TRANSCRIBE_KEY_INVALID'
    : status === 429 ? 'TRANSCRIBE_RATE_LIMITED' : status === 413 ? 'TRANSCRIBE_AUDIO_TOO_LONG' : 'TRANSCRIBE_REQUEST_FAILED';
  const error = new Error(`Transcription request failed: ${detail}`); error.code = code; error.status = status;
  return error;
};

/* Sends WAV bytes and returns word JSON. `fetchImpl` is injectable for tests; the key is sent only in the request header. */
J.transcribeAudio = async (wavBytes, options = {}) => {
  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) fail('TRANSCRIBE_REQUEST_FAILED', 'This browser cannot send the transcription request.');
  if (!options.apiKey) fail('TRANSCRIBE_KEY_REQUIRED', 'A Gemini API key is required.');
  let response;
  try {
    response = await fetchImpl(J.TRANSCRIBE_ENDPOINT, { method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify(J.transcribeRequest(J.bytesToBase64(wavBytes), options)) });
  } catch (error) {
    if (error && error.name === 'AbortError') fail('TRANSCRIBE_CANCELLED', 'Transcription was cancelled.');
    fail('TRANSCRIBE_NETWORK', 'The transcription service could not be reached.');
  }
  let body = null;
  try { body = await response.json(); } catch (error) { /* a non-JSON body is reported by its status */ }
  if (!response.ok) throw J.transcribeHttpError(response.status, body);
  return J.transcribeResponseToWordJson(body, options);
};
})();
