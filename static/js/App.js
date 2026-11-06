/* djwaltin — "do vídeo ao vinil"
   Fluxo: link → prévia (capa do disco) → prensagem → conversão (disco gira) → player → Lado B.
   Este arquivo só conecta as partes; cada parte da tela tem seu módulo em components/. */
import { drawBarcode, loopShelf, startClock } from './components/Decorations.js';
import { LinkField } from './components/LinkField.js';
import { Player } from './components/Player.js';
import { Steps } from './components/Steps.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { showToast } from './components/Toasts.js';
import { Tracklist } from './components/Tracklist.js';
import { Turntable } from './components/Turntable.js';
import { api, trackConversion } from './lib/Api.js';
import { prefersReducedMotion, scrollToSection, ui } from './lib/Dom.js';
import { estimateSize, formatDuration, formatMegabytes, joinParts } from './lib/Format.js';

new ThemeToggle();
const turntable = new Turntable();
const steps = new Steps();
const linkField = new LinkField({ onChange: (url) => (url ? loadPreview(url) : forgetVideo()) });
const player = new Player({ onPlayingChange: (playing) => turntable.spin(playing) });
const tracklist = new Tracklist({
  onConvertAgain: convertAgain,
  onClear: () => showToast('Tracklist apagada.'),
});

const state = {
  video: null, // prévia do link atual: campos da API + url
  requestedPreview: '', // evita pedir a mesma prévia duas vezes e ignora respostas atrasadas
  lastRequest: null, // { url, quality } para o "Tentar de novo"
  conversion: null, // AbortController do acompanhamento em andamento
};

const idleButtonLabel = ui.goLabel.textContent;
const qualityRadios = () => [...ui.form.elements.qualidade];
const selectedQuality = () => ui.form.elements.qualidade.value;

/* ---------- Prévia: o vídeo vira a capa do disco ---------- */

async function loadPreview(url) {
  if (url === state.requestedPreview) return;
  state.requestedPreview = url;

  linkField.mark('ok', 'Lendo o link…');
  turntable.loading = true;
  turntable.caption('Lendo o link…');

  try {
    const video = await api.readVideo(url);
    if (url !== state.requestedPreview) return;
    state.video = { ...video, url };
    turntable.cover = video.thumbnail;
    if (turntable.state !== 'working') turntable.state = 'ready';
    turntable.caption(video.titulo, joinParts(video.canal, formatDuration(video.duracao)));
    linkField.mark('ok', 'Vídeo encontrado. Escolha a prensagem e converta.');
  } catch (error) {
    if (url !== state.requestedPreview) return;
    state.video = null;
    turntable.clear();
    linkField.mark('error', error.message);
  }
  turntable.loading = false;
  showEstimatedSizes();
}

function forgetVideo() {
  state.video = null;
  state.requestedPreview = '';
  turntable.loading = false;
  if (turntable.state !== 'working' && ui.result.hidden) turntable.clear();
  showEstimatedSizes();
}

/** "≈ 4,4 MB" em cada prensagem, quando a duração do vídeo é conhecida. */
function showEstimatedSizes() {
  const seconds = state.video?.duracao || 0;
  for (const label of ui.form.querySelectorAll('.pressing-size')) {
    label.textContent = seconds ? `≈ ${formatMegabytes(estimateSize(Number(label.dataset.kbps), seconds))}` : '';
  }
}

/* ---------- Conversão ---------- */

function lockForm(locked) {
  ui.goBtn.disabled = locked;
  linkField.disabled = locked;
  for (const radio of qualityRadios()) radio.disabled = locked;
  ui.goLabel.textContent = locked ? ui.goLabel.dataset.busyLabel : idleButtonLabel;
}

function showStep(status) {
  const detail = steps.mark(status);
  if (status !== 'concluido') turntable.meta = detail;
  return detail;
}

async function convert(url, quality) {
  state.lastRequest = { url, quality };
  state.conversion?.abort();
  const { signal } = (state.conversion = new AbortController());

  ui.errorBox.hidden = true;
  ui.result.hidden = true;
  player.stop();
  lockForm(true);
  turntable.color = quality;
  turntable.state = 'working';
  turntable.spin(true);
  turntable.progress = 0;
  steps.visible = true;
  const detail = showStep('iniciando');
  if (!state.video) turntable.caption('Preparando…', detail);

  try {
    const { job_id: jobId } = await api.startConversion(url, quality);
    const job = await trackConversion(jobId, {
      signal,
      onUpdate: ({ progress, status }) => {
        turntable.progress = progress || 0;
        showStep(status);
      },
    });
    finish(jobId, job);
  } catch (error) {
    if (error.name !== 'AbortError') showError(error.message);
  }
}

function showError(message) {
  lockForm(false);
  turntable.spin(false);
  steps.visible = false;
  if (state.video) turntable.state = 'ready';
  else turntable.clear();
  ui.errorMsg.textContent = message;
  ui.errorBox.hidden = false;
  showToast('A conversão falhou.', { error: true });
}

function finish(jobId, job) {
  lockForm(false);
  turntable.spin(false);
  turntable.state = 'done';
  setTimeout(() => (steps.visible = false), 1200);

  const title = job.titulo || job.filename;
  const cover = job.thumbnail || state.video?.thumbnail || '';
  const size = job.tamanho || estimateSize(Number(job.qualidade), job.duracao || 0);
  turntable.cover = cover;
  turntable.caption(title, joinParts(`${job.qualidade} kbps`, formatMegabytes(size), formatDuration(job.duracao)));

  ui.resultLink.href = api.fileUrl(jobId);
  ui.resultLink.download = job.filename;
  ui.resultSize.textContent = formatMegabytes(size);
  ui.result.hidden = false;
  player.load(api.previewUrl(jobId));
  showToast('Disco prensado. Ouça a prévia ou salve o MP3.');

  tracklist.add({
    url: state.lastRequest?.url || '',
    titulo: title,
    canal: job.canal || '',
    thumbnail: cover,
    qualidade: job.qualidade,
    duracao: job.duracao || 0,
    quando: new Date().toISOString(),
  });
}

function convertAgain({ url, qualidade: quality }) {
  linkField.value = url;
  const radio = qualityRadios().find((r) => r.value === quality);
  if (radio) radio.checked = true;
  loadPreview(url);
  convert(url, quality);
  scrollToSection(ui.converter);
}

/* ---------- Eventos da página ---------- */

ui.form.addEventListener('change', ({ target }) => {
  if (target.name === 'qualidade') turntable.color = target.value;
});

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = linkField.validate();
  if (url) convert(url, selectedQuality());
});

ui.retryBtn.addEventListener('click', () => {
  if (state.lastRequest) convert(state.lastRequest.url, state.lastRequest.quality);
});

ui.resultLink.addEventListener('click', () => showToast('Download iniciado. Confira a pasta de downloads.'));

ui.againBtn.addEventListener('click', () => {
  player.stop();
  ui.result.hidden = true;
  linkField.clear();
});

ui.ctaStart.addEventListener('click', (event) => {
  event.preventDefault();
  scrollToSection(ui.converter);
  setTimeout(() => linkField.focus({ preventScroll: true }), prefersReducedMotion ? 0 : 600);
});

/* ---------- Início ---------- */

turntable.color = selectedQuality();
turntable.clear();
tracklist.render();
startClock();
drawBarcode();
loopShelf();
