import { ui } from '../lib/Dom.js';

const VISIBLE_MS = 3800;
const LEAVE_MS = 260; // mesma duração da animação .is-leaving em Toasts.css

/** Mostra um aviso rápido no canto da tela. */
export function showToast(message, { error = false } = {}) {
  const toast = document.createElement('div');
  toast.className = error ? 'toast is-error' : 'toast';
  toast.textContent = message;
  ui.toasts.append(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), LEAVE_MS);
  }, VISIBLE_MS);
}
