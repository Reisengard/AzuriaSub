/* ============================================================
   JIZURA — actionable Video Captions failure recovery (Gate 7.3)
   ============================================================ */
'use strict';

(() => {
const RECOVERY = Object.freeze({
  MEDIA_FILE_REQUIRED: 'Choose a local video and try again.',
  MEDIA_FILE_TYPE_UNSUPPORTED: 'Choose an H.264/AAC MP4 file.',
  MEDIA_VIDEO_CODEC_UNSUPPORTED: 'Convert the source video to H.264 MP4, then relink it.',
  MEDIA_AUDIO_CODEC_UNSUPPORTED: 'Convert the soundtrack to AAC in an MP4 file. JIZURA will not silently remove audio.',
  MEDIA_CONTAINER_MALFORMED: 'Re-export the source as a standard H.264/AAC MP4 and try again.',
  MEDIA_DEMUX_FAILED: 'Check that the file is a complete, readable MP4. Re-export it if necessary.',
  // No other caption encoder exists in the app: the fallback is the saved project, relinked and exported where H.264 works.
  MEDIA_ENCODER_UNSUPPORTED: 'Use the latest desktop Chrome or Edge, or update graphics drivers. Save the project, then open it with the same video on a computer where export works; nothing is lost.',
  MEDIA_FILE_SAVE_REQUIRED: 'Open JIZURA in Chrome or Edge so you can choose a file-backed save location.',
  MEDIA_AUDIO_PASSTHROUGH_UNAVAILABLE: 'Use AAC audio in the source MP4; audio is never omitted without warning.',
  MEDIA_AUDIO_START_UNSUPPORTED: 'Re-export the source with video and audio starting at 00:00.',
  MEDIA_AUDIO_DURATION_MISMATCH: 'Re-export the source with matching audio and video durations.',
  MEDIA_EXPORT_CANCELLED: 'Nothing else is required. Start Export again when ready.',
  MEDIA_EXPORT_FAILED: 'Close memory-heavy tabs, choose a file-backed save location, and retry in Chrome or Edge.',
  MEDIA_RELINK_MISMATCH: 'Choose the exact source video used when this project was saved.',
  UNSUPPORTED_SCHEMA_VERSION: 'Update JIZURA to a build that supports this project version. The file was not changed.',
  PROJECT_JSON_INVALID: 'Choose an unmodified JIZURA project JSON file.',
  TRANSCRIPT_JSON_INVALID: 'Fix the transcript JSON syntax or export it again, then re-import it.',
  UNSUPPORTED_TRANSCRIPT_SCHEMA_VERSION: 'Export the transcript in the current JIZURA timed-text format.',
  TOKEN_TIMING_OVERLAP: 'Correct the overlapping word times shown in the transcript and import it again.',
  TOKEN_START_NEGATIVE: 'Change negative word start times to zero or later.',
  TOKEN_END_BEFORE_START: 'Make every word end after it starts.',
  TOKEN_END_AFTER_DURATION: 'Keep word timings within the source-video duration.',
  SUBTITLE_CUE_TIMING_INVALID: 'Correct invalid or overlapping SRT/VTT cue times and import it again.',
  ESTIMATED_TIMING_REQUIRED: 'Mark SRT/VTT-derived tokens as estimated, or import word-timestamp JSON.',
  SUBTITLE_EXPORT_EMPTY: 'Add captions, or check that the kept sections of the video include some.',
  TRANSCRIPT_TIMING_INVALID: 'Correct overlapping or negative transcript timings, then import the file again.',
  TIMED_TEXT_WORD_TIMING_REQUIRED: 'Import word-timestamp JSON for precise active-word captions. SRT/VTT timing remains estimated.',
  TRANSCRIBE_KEY_REQUIRED: 'Paste your Gemini API key from Google AI Studio.',
  TRANSCRIBE_KEY_INVALID: 'Check the Gemini API key in Google AI Studio and paste it again.',
  TRANSCRIBE_RATE_LIMITED: 'The free quota is used up for now. Wait a minute, or check the rate limits in Google AI Studio.',
  TRANSCRIBE_AUDIO_TOO_LONG: 'Automatic transcription handles videos up to 7 minutes. For longer videos, import a transcript file.',
  TRANSCRIBE_AUDIO_UNREADABLE: 'Check that the video has an audio track this browser can decode.',
  TRANSCRIBE_NETWORK: 'Check the network connection and try again.',
  TRANSCRIBE_EMPTY: 'Check that the video contains speech and that the language setting matches, then try again.',
  TRANSCRIBE_REQUEST_FAILED: 'Try again in a moment. If it keeps failing, import a transcript file instead.',
  TRANSCRIBE_CANCELLED: 'Nothing else is required.',
  FONT_LOAD_FAILED: 'Check the network connection or choose another font; JIZURA will use a system fallback.',
  CAPTION_STATIC_FALLBACK: 'Shorten the caption or reduce motion/intensity if you want an animated alternative.',
});

J.MEDIA_RECOVERY_MESSAGES = RECOVERY;
J.recoveryForError = error => {
  let code = error && error.code || 'UNKNOWN';
  if (code === 'UNKNOWN' && error && (error.name === 'QuotaExceededError' || /memory|quota|write|disk/i.test(error.message || ''))) code = 'MEDIA_EXPORT_FAILED';
  const action = RECOVERY[code] || 'Check the source and project settings, then try again.';
  const message = error && error.message ? String(error.message) : 'The operation could not be completed.';
  return { code, message, action, display: `${message} ${action}` };
};
})();
