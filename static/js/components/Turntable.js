import { prefersReducedMotion, ui } from '../lib/Dom.js';

/** 33⅓ rpm ≈ 200°/s. */
const DEGREES_PER_SECOND = 200;

/**
 * O toca-discos do Lado A: capa, vinil girando, anel de progresso e legenda.
 * O visual de cada fase vem do CSS por `data-state`: idle | ready | working | done.
 */
export class Turntable {
  #angle = 0;
  #speed = 0;
  #targetSpeed = 0;
  #lastFrame = 0;
  #frame = null;
  #emptyCaption = [ui.captionTitle.textContent, ui.captionMeta.textContent];

  get state() {
    return ui.record.dataset.state;
  }

  set state(state) {
    ui.record.dataset.state = state;
  }

  set loading(on) {
    ui.record.classList.toggle('is-loading', on);
  }

  set color(kbps) {
    ui.record.style.setProperty('--vinyl-current', `var(--vinyl-${kbps})`);
  }

  set progress(percent) {
    ui.record.style.setProperty('--p', String(percent));
    ui.progressPct.textContent = String(percent);
    ui.meter.setAttribute('aria-valuenow', String(percent));
  }

  /** A miniatura do vídeo vira capa e rótulo do disco; sem imagem, volta ao padrão. */
  set cover(url) {
    for (const image of [ui.sleeveImg, ui.labelImg]) {
      const frame = image.parentElement;
      frame.classList.remove('has-image');
      if (url) {
        image.onload = () => frame.classList.add('has-image');
        image.src = url;
      } else {
        image.removeAttribute('src');
      }
    }
  }

  caption(title, meta = '') {
    ui.captionTitle.textContent = title;
    this.meta = meta;
  }

  /** Linha menor da legenda: canal, duração, etapa da conversão… */
  set meta(text) {
    ui.captionMeta.textContent = text;
  }

  clear() {
    this.state = 'idle';
    this.cover = '';
    this.caption(...this.#emptyCaption);
  }

  /** Liga ou desliga o giro, com a inércia de um toca-discos de verdade. */
  spin(on) {
    document.body.classList.toggle('is-spinning', on);
    if (prefersReducedMotion) return;
    this.#targetSpeed = on ? DEGREES_PER_SECOND : 0;
    if (!this.#frame) {
      this.#lastFrame = performance.now();
      this.#frame = requestAnimationFrame((time) => this.#animate(time));
    }
  }

  #animate(now) {
    const dt = Math.min(0.05, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    this.#speed += (this.#targetSpeed - this.#speed) * Math.min(1, dt * 2.4);
    this.#angle = (this.#angle + this.#speed * dt) % 360;
    ui.vinyl.style.transform = `rotate(${this.#angle}deg)`;

    const stopped = this.#targetSpeed === 0 && this.#speed < 0.5;
    if (stopped) {
      this.#speed = 0;
      this.#frame = null;
    } else {
      this.#frame = requestAnimationFrame((time) => this.#animate(time));
    }
  }
}
