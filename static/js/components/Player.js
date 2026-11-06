import { ui } from '../lib/Dom.js';
import { formatDuration } from '../lib/Format.js';

const BAR_COUNT = 120;
const PLACEHOLDER_BAR_HEIGHT = 0.06;

/**
 * Prévia do MP3 pronto: play/pausa, onda sonora clicável e tempo.
 * `onPlayingChange(playing)` avisa quando o áudio começa ou para (o disco gira junto).
 */
export class Player {
  #onPlayingChange;
  #peaks = null;
  #audioUrl = null;

  constructor({ onPlayingChange }) {
    this.#onPlayingChange = onPlayingChange;
    const { audio, playBtn, seek } = ui;

    playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
    audio.addEventListener('play', () => this.#setPlaying(true));
    audio.addEventListener('pause', () => this.#setPlaying(false));
    audio.addEventListener('timeupdate', () => this.#updateTime());
    audio.addEventListener('loadedmetadata', () => this.#updateTime());
    seek.addEventListener('input', () => {
      if (audio.duration) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
    });
    addEventListener('resize', () => this.#drawWaveform());
    document.documentElement.addEventListener('themechange', () => this.#drawWaveform());
  }

  /** Baixa o MP3 uma vez: os mesmos bytes alimentam o <audio> e o desenho da onda. */
  async load(url) {
    this.#setEnabled(false);
    ui.waveLoading.hidden = false;
    this.#peaks = null;
    this.#drawWaveform();

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(response.statusText);
      const buffer = await response.arrayBuffer();
      // slice: decodeAudioData consome o buffer, então o Blob precisa de uma cópia
      this.#audioUrl = URL.createObjectURL(new Blob([buffer.slice(0)], { type: 'audio/mpeg' }));
      ui.audio.src = this.#audioUrl;
      this.#peaks = await computePeaks(buffer);
    } catch {
      // Sem onda: o <audio> continua funcionando se o src foi definido
    } finally {
      ui.waveLoading.hidden = true;
      this.#setEnabled(Boolean(ui.audio.src));
      this.#drawWaveform();
    }
  }

  stop() {
    const { audio, seek } = ui;
    audio.pause();
    if (this.#audioUrl) URL.revokeObjectURL(this.#audioUrl);
    this.#audioUrl = null;
    audio.removeAttribute('src');
    audio.load();
    seek.value = '0';
    ui.time.textContent = '0:00 / 0:00';
  }

  #setEnabled(enabled) {
    ui.playBtn.disabled = !enabled;
    ui.seek.disabled = !enabled;
  }

  #setPlaying(playing) {
    ui.playBtn.classList.toggle('is-playing', playing);
    ui.playBtn.setAttribute('aria-label', playing ? 'Pausar prévia' : 'Tocar prévia');
    document.body.classList.toggle('is-playing', playing);
    this.#onPlayingChange(playing);
  }

  #updateTime() {
    const { currentTime, duration } = ui.audio;
    ui.time.textContent = `${formatDuration(currentTime) || '0:00'} / ${formatDuration(duration) || '0:00'}`;
    if (duration) ui.seek.value = String((currentTime / duration) * 100);
    this.#drawWaveform();
  }

  /** Barras de baixo para cima, como um espectro; a parte já tocada usa a cor de destaque. */
  #drawWaveform() {
    const canvas = ui.wave;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width) return;

    const dpr = devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);

    const tokens = getComputedStyle(document.documentElement);
    const playedColor = tokens.getPropertyValue('--accent').trim();
    const restColor = tokens.getPropertyValue('--line-strong').trim();
    const bars = this.#peaks ?? Array(BAR_COUNT).fill(PLACEHOLDER_BAR_HEIGHT);
    const barWidth = width / bars.length;
    const { currentTime, duration } = ui.audio;
    const played = duration ? currentTime / duration : 0;

    bars.forEach((peak, i) => {
      const barHeight = Math.max(2, peak * height);
      context.fillStyle = i / bars.length < played ? playedColor : restColor;
      context.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 2), barHeight);
    });
  }
}

/** Pico de volume de cada trecho do áudio, normalizado entre 0 e 1. */
async function computePeaks(buffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  const context = new AudioContextClass();
  const samples = (await context.decodeAudioData(buffer)).getChannelData(0);
  context.close();

  const step = Math.floor(samples.length / BAR_COUNT);
  const peaks = Array.from({ length: BAR_COUNT }, (_, bar) => {
    let peak = 0;
    for (let i = bar * step; i < (bar + 1) * step; i += 32) peak = Math.max(peak, Math.abs(samples[i]));
    return peak;
  });
  const highest = Math.max(...peaks);
  return peaks.map((peak) => (highest ? peak / highest : 0));
}
