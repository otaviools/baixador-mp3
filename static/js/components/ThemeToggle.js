import { prefersReducedMotion, ui } from '../lib/Dom.js';

const STORAGE_KEY = 'djwaltin-theme';
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

const savedTheme = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Chave de tema claro/escuro no header. O tema inicial é aplicado pelo script inline do
 * Index.html; aqui ficam em sincronia o botão, o theme-color do navegador e a escolha salva.
 * Enquanto a pessoa não escolhe um tema, a página segue a preferência do sistema.
 * Dispara `themechange` no <html> para os desenhos em canvas (a onda sonora) se redesenharem.
 */
export class ThemeToggle {
  constructor() {
    this.#sync();
    ui.themeToggle.addEventListener('click', () => this.#toggle());
    systemDark.addEventListener('change', ({ matches }) => {
      if (!savedTheme()) this.#apply(matches ? 'dark' : 'light');
    });
  }

  get theme() {
    return root.dataset.theme;
  }

  #toggle() {
    const next = this.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem localStorage: a escolha vale até recarregar a página
    }

    if (prefersReducedMotion || !document.startViewTransition) {
      this.#apply(next);
      return;
    }
    this.#setRevealOrigin();
    document.startViewTransition(() => this.#apply(next));
  }

  /** A revelação circular nasce na chave e cresce até o canto mais distante da tela. */
  #setRevealOrigin() {
    const { left, top, width, height } = ui.themeToggle.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.style.setProperty('--reveal-x', `${x}px`);
    root.style.setProperty('--reveal-y', `${y}px`);
    root.style.setProperty('--reveal-r', `${radius}px`);
  }

  #apply(theme) {
    root.dataset.theme = theme;
    this.#sync();
    root.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  /** O rótulo do botão fica "Tema escuro"; o aria-pressed diz se está ligado. */
  #sync() {
    ui.themeToggle.setAttribute('aria-pressed', String(this.theme === 'dark'));
    ui.themeColor.content = getComputedStyle(root).getPropertyValue('--paper').trim();
  }
}
