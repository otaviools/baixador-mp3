/** Elementos da página pelo id: `ui.goBtn` equivale a `document.getElementById('goBtn')`. */
export const ui = new Proxy({}, {
  get: (cache, id) => (cache[id] ??= document.getElementById(id)),
});

export const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function scrollToSection(element) {
  element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}
