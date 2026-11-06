/** Detalhes visuais que não dependem do conversor: relógio, código de barras e prateleira. */
import { prefersReducedMotion, ui } from '../lib/Dom.js';

export function startClock() {
  const update = () => {
    const now = new Date();
    ui.clock.textContent = `Local ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    ui.clock.dateTime = now.toISOString();
  };
  update();
  setInterval(update, 15_000);
}

/** Barras geradas a partir de um texto fixo: o desenho é sempre o mesmo. */
export function drawBarcode(seed = 'djwaltin-001') {
  const bars = [];
  for (let x = 0, i = 0; x < 118; i++) {
    const width = ((seed.charCodeAt(i % seed.length) + i * 7) % 3) + 1;
    if (i % 2 === 0) {
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [name, value] of Object.entries({ x, y: 0, width: width * 0.9, height: 28, fill: 'currentColor' })) {
        bar.setAttribute(name, String(value));
      }
      bars.push(bar);
    }
    x += width * 1.1;
  }
  ui.barcode.append(...bars);
}

/**
 * Duplica as capas da prateleira: a animação anda -50% e recomeça sem emenda.
 * As cópias ficam fora da árvore de acessibilidade para não serem lidas duas vezes.
 */
export function loopShelf() {
  if (prefersReducedMotion) return;
  const copies = [...ui.erasTrack.children].map((sleeve) => {
    const copy = sleeve.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    return copy;
  });
  ui.erasTrack.append(...copies);
}
