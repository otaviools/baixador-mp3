/** Aceita youtube.com (watch, shorts, live, embed), youtu.be, m. e music. */
const YOUTUBE_LINK =
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

export const isYouTubeLink = (text) => YOUTUBE_LINK.test(text.trim());

/** Texto que já tem cara de URL completa (para só reclamar quando a pessoa terminou de digitar). */
export const looksLikeUrl = (text) => /^https?:\/\/\S+\.\S+/.test(text);
