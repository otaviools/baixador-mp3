/**
 * Cliente das rotas do Flask (app.py). Erros da API viram um `Error` com a mensagem do servidor.
 * Rotas e campos JSON ficam em português: são o contrato da API.
 */

async function request(url, options, fallbackError = 'Erro desconhecido.') {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || fallbackError);
  return data;
}

const post = (url, body) =>
  request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const api = {
  readVideo: (url) => post('/api/info', { url }),
  startConversion: (url, quality) => post('/api/baixar', { url, qualidade: quality }),
  status: (jobId) => request(`/api/status/${jobId}`, undefined, 'Erro ao consultar status.'),
  fileUrl: (jobId) => `/api/arquivo/${jobId}`,
  previewUrl: (jobId) => `/api/ouvir/${jobId}`,
};

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

/**
 * Consulta o status do job até ele terminar.
 * Chama `onUpdate(job)` a cada consulta e resolve com o job concluído.
 * Rejeita com a mensagem do servidor se a conversão falhar, ou com AbortError se `signal` for abortado.
 */
export async function trackConversion(jobId, { onUpdate, signal, interval = 800 }) {
  for (;;) {
    await wait(interval, signal);
    const job = await api.status(jobId);
    signal?.throwIfAborted();
    if (job.status === 'erro') throw new Error(job.erro || 'Erro desconhecido durante o download.');
    onUpdate(job);
    if (job.status === 'concluido') return job;
  }
}
