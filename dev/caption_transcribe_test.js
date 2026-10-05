/* Hosted transcription adapter (src/10g_caption_transcribe.js): WAV encoding, request shape, response -> word JSON, error codes.
   No network: the request goes to an injected fetch. */
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add() {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({}) }) };
for (const file of fs.readdirSync(path.join(root, 'src')).filter(file => file.endsWith('.js') && file !== '12_ui.js').sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });

// WAV: 44-byte header, mono, 16-bit, little-endian samples, clipped.
const wav = J.encodeWavPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000), view = new DataView(wav.buffer);
assert.equal(wav.length, 44 + 12);
assert.equal(String.fromCharCode(...wav.subarray(0, 4)) + String.fromCharCode(...wav.subarray(8, 16)), 'RIFFWAVEfmt ');
assert.deepEqual([view.getUint32(4, true), view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint32(28, true), view.getUint16(34, true), view.getUint32(40, true)], [48, 1, 1, 16000, 32000, 16, 12]);
assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768, 16384]);
assert.equal(J.bytesToBase64(new Uint8Array([72, 105, 33])), 'SGkh');
assert.ok(J.TRANSCRIBE_MAX_SECONDS * J.TRANSCRIBE_SAMPLE_RATE * 2 * 4 / 3 < 19e6, 'the longest allowed audio must fit the 20 MB inline request');

// Request: the documented Interactions shape, word timestamps in verbatim mode, nothing stored.
const request = J.transcribeRequest('QUJD', { languageCode: 'ja-JP' });
assert.deepEqual(request, { model: 'gemini-3.5-transcribe', input: [{ type: 'audio', data: 'QUJD', mime_type: 'audio/wav' }],
  generation_config: { transcription_config: { language_codes: ['ja-JP'], mode: { type: 'verbatim', timestamp_granularities: ['word'] } } }, store: false });
assert.deepEqual(J.transcribeRequest('QUJD').generation_config.transcription_config.language_codes, [], 'no language code means automatic detection');

// Response: the shape documented at ai.google.dev/gemini-api/docs/transcribe.
const word = (text, start, end) => ({ type: 'word_info', text, start_offset: start, end_offset: end });
const interaction = words => ({ id: 'interactions/x', status: 'completed', steps: [{ id: 'step_001', type: 'model_output', content: [{ type: 'text', text: '', annotations: words }] }] });
const english = J.transcribeResponseToWordJson(interaction([word('Hello', '0.100s', '0.450s'), word('world', '0.500s', '0.850s'), { type: 'citation', text: 'ignored' }]), { language: 'en', duration: 5 });
assert.deepEqual(english, { schemaVersion: 1, language: 'en', tokens: [{ text: 'Hello', start: 0.1, end: 0.45 }, { text: 'world', start: 0.5, end: 0.85 }] });

// Repairs: overlap, inverted and missing ends, past-the-end times, stray punctuation, empty text; a multi-word Japanese chunk is split.
const messy = interaction([
  word('今日はいい天気ですね', '0.000s', '2.000s'),
  word('。', '2.000s', '2.050s'),
  word('散歩', '1.800s', '2.600s'),          // starts before the previous word ended
  word('に', '2.700s', '2.650s'),            // ends before it starts
  word('  ', '2.800s', '2.900s'),            // nothing to show
  word('行こう', '3.000s'),                  // no end
  word('OK', 3.4, 3.9),                      // numeric offsets
  word('さよなら', '9.500s', '11.000s'),     // beyond the 10 s video
  word('bad', 'soon', '12s'),                // unreadable start
]);
const json = J.transcribeResponseToWordJson(messy, { language: 'ja', duration: 10 });
const imported = J.importWordJson(json, { duration: 10, source: 'gemini' });   // throws if any repair was missed
assert.equal(imported.timingQuality, 'word'); assert.equal(imported.language, 'ja');
assert.ok(imported.tokens.every(token => token.source === 'gemini' && token.timingQuality === 'word'));
assert.equal(imported.tokens.map(token => token.text).join(''), '今日はいい天気ですね。散歩に行こうOKさよなら');
const firstChunk = imported.tokens.filter(token => token.end <= 2);
assert.ok(firstChunk.length > 1, 'a multi-word Japanese chunk must be split into words');
assert.equal(firstChunk[0].start, 0); assert.equal(firstChunk[firstChunk.length - 1].end, 2);
assert.ok(firstChunk[firstChunk.length - 1].text.endsWith('。'), 'punctuation joins the word before it');
const byText = text => imported.tokens.find(token => token.text === text);
assert.equal(byText('散歩').start, 2, 'an overlapping word starts where the previous one ended');
assert.deepEqual([byText('に').start, byText('に').end], [2.7, 2.7]);
assert.equal(imported.tokens.filter(token => token.start === 3 && token.end === 3).map(token => token.text).join(''), '行こう', 'a word without an end keeps its start');
assert.ok(imported.tokens[imported.tokens.length - 1].end <= 10, 'no word may end after the video');
assert.equal(J.segmentCaptions(imported, { duration: 10 }).segments.length > 0, true);
assert.deepEqual(J.transcribeResponseToWordJson(messy, { language: 'ja', duration: 10 }), json, 'same response, same words');

assert.throws(() => J.transcribeResponseToWordJson(interaction([]), {}), { code: 'TRANSCRIBE_EMPTY' });
assert.throws(() => J.transcribeResponseToWordJson({ steps: [{ content: [{ type: 'text', text: 'no timestamps' }] }] }, {}), { code: 'TRANSCRIBE_EMPTY' });

// Errors: the code decides the recovery hint.
const keyError = [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }];
assert.equal(J.transcribeHttpError(400, keyError).code, 'TRANSCRIBE_KEY_INVALID');
assert.equal(J.transcribeHttpError(400, keyError[0]).code, 'TRANSCRIBE_KEY_INVALID');
assert.equal(J.transcribeHttpError(429, { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }).code, 'TRANSCRIBE_RATE_LIMITED');
assert.equal(J.transcribeHttpError(500, null).code, 'TRANSCRIBE_REQUEST_FAILED');
for (const code of ['TRANSCRIBE_KEY_REQUIRED', 'TRANSCRIBE_KEY_INVALID', 'TRANSCRIBE_RATE_LIMITED', 'TRANSCRIBE_AUDIO_TOO_LONG', 'TRANSCRIBE_AUDIO_UNREADABLE', 'TRANSCRIBE_NETWORK', 'TRANSCRIBE_EMPTY', 'TRANSCRIBE_REQUEST_FAILED', 'TRANSCRIBE_CANCELLED']) {
  assert.ok(J.MEDIA_RECOVERY_MESSAGES[code], `${code} needs a recovery hint`);
}

(async () => {
  const calls = [];
  const reply = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  const result = await J.transcribeAudio(wav, { apiKey: 'test-key', languageCode: 'en-US', language: 'en', duration: 5, fetch: reply(200, interaction([word('Hello', '0.100s', '0.450s')])) });
  assert.deepEqual(result.tokens, [{ text: 'Hello', start: 0.1, end: 0.45 }]);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'test-key');
  assert.ok(!calls[0].url.includes('test-key') && !calls[0].init.body.includes('test-key'), 'the key travels only in the header');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.input[0].data, J.bytesToBase64(wav)); assert.deepEqual(sent.generation_config.transcription_config.language_codes, ['en-US']);
  await assert.rejects(J.transcribeAudio(wav, { fetch: reply(200, {}) }), { code: 'TRANSCRIBE_KEY_REQUIRED' });
  await assert.rejects(J.transcribeAudio(wav, { apiKey: 'k', fetch: reply(400, keyError) }), { code: 'TRANSCRIBE_KEY_INVALID' });
  await assert.rejects(J.transcribeAudio(wav, { apiKey: 'k', fetch: reply(429, {}) }), { code: 'TRANSCRIBE_RATE_LIMITED' });
  await assert.rejects(J.transcribeAudio(wav, { apiKey: 'k', fetch: async () => { throw new TypeError('Failed to fetch'); } }), { code: 'TRANSCRIBE_NETWORK' });
  await assert.rejects(J.transcribeAudio(wav, { apiKey: 'k', fetch: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } }), { code: 'TRANSCRIBE_CANCELLED' });

  // The workbench offers it, says where the audio goes, and keeps the key out of the project.
  const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8'), workbench = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');
  assert.match(body, /<dialog id="captionTranscribeDlg"[\s\S]*音声が Google に送信されます[\s\S]*id="captionTranscribeKey" type="password"[\s\S]*id="captionTranscribeStart"[\s\S]*<\/dialog>/);
  assert.match(body, /id="captionTranscribeOpen"/);
  assert.match(workbench, /J\.transcribeAudio\(/); assert.match(workbench, /J\.importWordJson\(words, \{[^}]*source: 'gemini'/);
  assert.doesNotMatch(workbench, /project\.[A-Za-z.]*(apiKey|geminiKey)/, 'the API key must never be written into the project');
  console.log('Hosted transcription adapter: WAV, request, response repair, error codes and workbench wiring passed.');
})().catch(error => { console.error(error); process.exit(1); });
