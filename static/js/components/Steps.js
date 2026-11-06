import { ui } from '../lib/Dom.js';

/**
 * Lista "01 Conectando → 04 Pronto". Cada <li> traz o status do job em `data-step`
 * e a frase lida por leitores de tela em `data-detail` (veja partials/Converter.html).
 */
export class Steps {
  #items = [...ui.steps.children];

  set visible(visible) {
    ui.steps.hidden = !visible;
  }

  /** Marca a etapa desse status e devolve a frase dela ("Baixando o áudio"). */
  mark(status) {
    const current = this.#items.findIndex((item) => item.dataset.step === status);
    const finished = status === 'concluido';

    this.#items.forEach((item, i) => {
      const done = i < current || finished;
      item.classList.toggle('is-done', done);
      item.classList.toggle('is-active', i === current && !done);
      if (i === current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });

    const detail = this.#items[current]?.dataset.detail ?? '';
    ui.stepStatus.textContent = detail;
    return detail;
  }
}
