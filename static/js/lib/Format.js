/** Formatação dos textos exibidos na interface (pt-BR). */

const twoDigits = (n) => String(n).padStart(2, '0');

/** 75 → "1:15"; 3725 → "1:02:05"; 0 → "". */
export function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${twoDigits(m)}:${twoDigits(s)}` : `${m}:${twoDigits(s)}`;
}

/** 3_250_000 → "3,1 MB"; 0 → "". */
export function formatMegabytes(bytes) {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** Tamanho aproximado de um MP3: bitrate (kbps) × duração. */
export const estimateSize = (kbps, seconds) => ((kbps * 1000) / 8) * seconds;

export const formatShortDate = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Junta só as partes preenchidas: ["a", "", "b"] → "a · b". */
export const joinParts = (...parts) => parts.filter(Boolean).join(' · ');
