/* ============================================================
   JIZURA — caption style file ("Save style" / "Load style")

   Everything that decides how captions look, without the words, timing or video:
     style        project style: preset, treatment, accent, alignment, writing mode, motion, intensity, emphasis,
                  the chosen effects (look) and their settings, editor mode
     techniques   the effect techniques the advanced editor enabled
     tracks[]     per track: its style overrides and its Word styles (base / active / emphasis roles)
   Not included: caption text, timing, word density (segmentation), boxes and positions, per-caption overrides
   and video edits. Those belong to the project, not to the look.
   Tracks are matched by id (the primary track by its flag); tracks the file does not know are left alone.
   Loading goes to one track the user chooses (apply-caption-style with trackId): that track takes the file's look as its own
   style and roles; the project style and the other tracks stay.
   ============================================================ */
(() => {
'use strict';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const presetError = (message, details) => new J.ProjectError('CAPTION_STYLE_FILE_INVALID', message, details);

J.CAPTION_STYLE_FILE_KIND = 'jizura-caption-style';
J.CAPTION_STYLE_FILE_VERSION = 1;

const withoutSegmentation = style => { const out = clone(style); delete out.segmentation; return out; };

/* The style file content for a project. */
J.captionStylePreset = project => {
  const source = project && project.style;
  const style = plain(source) ? withoutSegmentation(source) : { preset: typeof source === 'string' ? source : 'creator' };
  const preset = {
    kind: J.CAPTION_STYLE_FILE_KIND, version: J.CAPTION_STYLE_FILE_VERSION,
    style,
    techniques: plain(project && project.techniques) ? clone(project.techniques) : {},
    tracks: ((project && project.tracks) || []).map(track => ({
      id: track.id, primary: !!track.primary,
      style: withoutSegmentation(plain(track.style) ? track.style : {}),
      roles: J.normalizeCaptionRoles(track.roles),
    })),
  };
  return preset;
};

/* Parse text or an object into a validated, clean style file. Throws CAPTION_STYLE_FILE_INVALID. */
J.parseCaptionStylePreset = input => {
  let data = input;
  if (typeof input === 'string') { try { data = JSON.parse(input); } catch (_) { throw presetError('This is not a JIZURA style file (the JSON could not be read).'); } }
  if (!plain(data) || data.kind !== J.CAPTION_STYLE_FILE_KIND) throw presetError('This is not a JIZURA style file.');
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > J.CAPTION_STYLE_FILE_VERSION) throw presetError(`Style file version ${String(data.version)} is not supported.`);
  if (!plain(data.style)) throw presetError('The style file has no style.');
  const style = withoutSegmentation(data.style);
  if (style.preset !== undefined && !(typeof style.preset === 'string' && J.CAPTION_STYLE_PROFILES && Object.prototype.hasOwnProperty.call(J.CAPTION_STYLE_PROFILES, style.preset))) throw presetError(`The style file uses an unknown caption style "${String(style.preset)}".`);
  try {
    if (style.look !== undefined) style.look = J.normalizeCaptionLook(style.look);
    if (style.lookSettings !== undefined) style.lookSettings = J.normalizeCaptionLookSettings(style.lookSettings);
  } catch (error) { throw presetError(error.message, error.details); }
  const techniques = data.techniques === undefined ? {} : data.techniques;
  if (!plain(techniques)) throw presetError('The style file techniques must be an object.');
  if (data.tracks !== undefined && !Array.isArray(data.tracks)) throw presetError('The style file tracks must be a list.');
  const tracks = (data.tracks || []).map(entry => {
    if (!plain(entry)) throw presetError('A track in the style file must be an object.');
    try {
      return { id: typeof entry.id === 'string' ? entry.id : null, primary: entry.primary === true,
        style: J.normalizeCaptionTrackStyle(withoutSegmentation(plain(entry.style) ? entry.style : {})), roles: J.normalizeCaptionRoles(entry.roles) };
    } catch (error) { throw presetError(error.message, error.details); }
  });
  return { kind: data.kind, version: data.version, style, techniques: clone(techniques), tracks };
};
})();
