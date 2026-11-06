import { ui } from '../lib/Dom.js';
import { formatDuration, formatShortDate, joinParts } from '../lib/Format.js';

// Dados salvos: a chave e os campos ficam como estão para os históricos existentes continuarem abrindo
const STORAGE_KEY = 'djwaltin-historico';
const MAX_TRACKS = 12;

/** Histórico guardado só neste navegador (localStorage). */
const history = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  },
  save(tracks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks.slice(0, MAX_TRACKS)));
    } catch {
      // Sem localStorage: o histórico só não persiste
    }
  },
};

/**
 * Lado B: as faixas convertidas. Cada linha é clonada do <template id="trackTemplate">.
 * Formato de cada item: { url, titulo, canal, thumbnail, qualidade, duracao, quando }.
 */
export class Tracklist {
  #onConvertAgain;

  constructor({ onConvertAgain, onClear }) {
    this.#onConvertAgain = onConvertAgain;
    ui.clearHistory.addEventListener('click', () => {
      history.save([]);
      this.render();
      onClear();
    });
  }

  /** Coloca a faixa no topo; a mesma URL na mesma qualidade não se repete. */
  add(track) {
    const others = history.read().filter((t) => !(t.url === track.url && t.qualidade === track.qualidade));
    history.save([track, ...others]);
    this.render();
  }

  render() {
    const tracks = history.read();
    ui.historyList.replaceChildren(...tracks.map((track, i) => this.#row(track, i)));
    ui.historyEmpty.hidden = tracks.length > 0;
    ui.clearHistory.hidden = tracks.length === 0;
  }

  #row(track, index) {
    const row = ui.trackTemplate.content.firstElementChild.cloneNode(true);
    const part = (className) => row.querySelector(`.${className}`);

    row.style.animationDelay = `${index * 40}ms`;
    row.style.setProperty('--vinyl', `var(--vinyl-${track.qualidade})`);

    part('track-no').textContent = String(index + 1).padStart(2, '0');
    if (track.thumbnail) row.querySelector('img').src = track.thumbnail;
    part('track-title').textContent = track.titulo;
    part('track-sub').textContent = track.canal || '—';
    part('track-meta').append(
      joinParts(`${track.qualidade} kbps`, formatDuration(track.duracao) || '—', formatShortDate(track.quando)),
    );

    const button = row.querySelector('button');
    button.setAttribute('aria-label', `${button.textContent}: ${track.titulo}`);
    button.disabled = !track.url;
    button.addEventListener('click', () => this.#onConvertAgain(track));

    return row;
  }
}
