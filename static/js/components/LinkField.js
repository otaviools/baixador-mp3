import { ui } from '../lib/Dom.js';
import { isYouTubeLink, looksLikeUrl } from '../lib/YouTube.js';
import { showToast } from './Toasts.js';

const TYPING_DELAY_MS = 450;

const MESSAGES = {
  empty: 'Cole um link do YouTube primeiro.',
  invalid: 'Esse não parece um link do YouTube. Confira e cole de novo.',
  emptyClipboard: 'A área de transferência está vazia.',
  clipboardDenied: 'Não consegui ler a área de transferência. Use Ctrl+V.',
};

/**
 * Campo "01 — Link do vídeo" com os botões Colar e X.
 * Chama `onChange(url)` com um link válido do YouTube, ou `onChange(null)` quando não há link válido.
 */
export class LinkField {
  #onChange;
  #timer = null;
  #defaultHint = ui.urlHint.textContent;

  constructor({ onChange }) {
    this.#onChange = onChange;

    ui.url.addEventListener('input', () => {
      this.#updateClearButton();
      this.#defer(() => this.#evaluate({ immediate: false }), TYPING_DELAY_MS);
    });
    ui.url.addEventListener('paste', () => this.#defer(() => this.#evaluate({ immediate: true }), 0));
    ui.url.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.value) {
        event.preventDefault();
        this.clear();
      }
    });
    ui.clearBtn.addEventListener('click', () => this.clear());
    ui.pasteBtn.addEventListener('click', () => this.#paste());
  }

  get value() {
    return ui.url.value.trim();
  }

  /** Preenche o campo sem chamar `onChange`. */
  set value(url) {
    clearTimeout(this.#timer);
    ui.url.value = url;
    this.#updateClearButton();
  }

  set disabled(disabled) {
    ui.url.disabled = disabled;
    ui.pasteBtn.disabled = disabled;
    ui.clearBtn.disabled = disabled;
  }

  focus(options) {
    ui.url.focus(options);
  }

  clear() {
    this.value = '';
    this.mark('neutral');
    this.#onChange(null);
    this.focus();
  }

  /** Estado visual do campo: 'neutral' | 'ok' | 'error', com a dica abaixo dele. */
  mark(state, message = this.#defaultHint) {
    const error = state === 'error';
    ui.urlBox.classList.toggle('is-invalid', error);
    ui.urlHint.classList.toggle('is-error', error);
    ui.urlHint.classList.toggle('is-ok', state === 'ok');
    ui.urlHint.textContent = message;
    ui.url.setAttribute('aria-invalid', String(error));
  }

  /** No envio: devolve o link válido, ou marca o erro e devolve null. */
  validate() {
    const url = this.value;
    const problem = !url ? MESSAGES.empty : !isYouTubeLink(url) ? MESSAGES.invalid : null;
    if (!problem) return url;
    this.mark('error', problem);
    this.focus();
    return null;
  }

  #defer(action, ms) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(action, ms);
  }

  #updateClearButton() {
    ui.clearBtn.hidden = !ui.url.value;
  }

  #evaluate({ immediate }) {
    this.#updateClearButton();
    const url = this.value;

    if (url && isYouTubeLink(url)) return this.#onChange(url);

    // Enquanto a pessoa ainda digita, só reclama quando o texto já parece uma URL completa
    const complain = url && (immediate || looksLikeUrl(url));
    if (complain) this.mark('error', MESSAGES.invalid);
    else this.mark('neutral');
    this.#onChange(null);
  }

  async #paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return showToast(MESSAGES.emptyClipboard, { error: true });
      ui.url.value = text;
      this.focus();
      this.#evaluate({ immediate: true });
    } catch {
      showToast(MESSAGES.clipboardDenied, { error: true });
      this.focus();
    }
  }
}
