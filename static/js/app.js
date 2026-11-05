/* djwaltin — "do vídeo ao vinil"
   Fluxo: link → prévia (capa do disco) → prensagem → conversão (disco gira) → player → Lado B */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const form = $('form');
  const urlInput = $('url');
  const urlBox = $('urlBox');
  const urlHint = $('urlHint');
  const pasteBtn = $('pasteBtn');
  const goBtn = $('goBtn');
  const goLabel = $('goLabel');
  const steps = $('steps');
  const record = $('record');
  const vinyl = $('vinyl');
  const result = $('result');
  const errorBox = $('errorBox');

  const HINT_PADRAO = urlHint.textContent;
  const BOTAO_PADRAO = goLabel.textContent;

  /* ================= Utilidades ================= */

  const YT_REGEX =
    /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;
  const linkValido = (url) => YT_REGEX.test(url.trim());

  function formatarDuracao(segundos) {
    if (!segundos) return '';
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = Math.floor(segundos % 60);
    return `${h ? h + ':' : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
  }

  const tamanhoEstimado = (kbps, segundos) => (kbps * 1000 / 8) * segundos;

  function formatarMB(bytes) {
    if (!bytes) return '';
    return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  }

  const qualidadeAtual = () => form.querySelector('input[name="qualidade"]:checked').value;

  async function postJSON(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.erro || 'Erro desconhecido.');
    return data;
  }

  function toast(mensagem, tipo = 'ok') {
    const el = document.createElement('div');
    el.className = `toast${tipo === 'erro' ? ' is-error' : ''}`;
    el.textContent = mensagem;
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 260);
    }, 3800);
  }

  /* ================= Header: relógio ================= */

  function atualizarRelogio() {
    const agora = new Date();
    $('clock').textContent = `Local ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    $('clock').setAttribute('datetime', agora.toISOString());
  }
  atualizarRelogio();
  setInterval(atualizarRelogio, 15000);

  /* ================= O disco ================= */

  // Giro com inércia: acelera e desacelera como um toca-discos (33⅓ rpm = 200°/s)
  const GRAUS_POR_SEGUNDO = 200;
  let angulo = 0;
  let velocidade = 0;
  let alvo = 0;
  let ultimoQuadro = 0;
  let raf = null;

  function girar(ligado) {
    document.body.classList.toggle('is-spinning', ligado);
    if (reduzMovimento) return;
    alvo = ligado ? GRAUS_POR_SEGUNDO : 0;
    if (!raf) {
      ultimoQuadro = performance.now();
      raf = requestAnimationFrame(quadro);
    }
  }

  function quadro(t) {
    const dt = Math.min(0.05, (t - ultimoQuadro) / 1000);
    ultimoQuadro = t;
    velocidade += (alvo - velocidade) * Math.min(1, dt * 2.4);
    angulo = (angulo + velocidade * dt) % 360;
    vinyl.style.transform = `rotate(${angulo}deg)`;
    if (alvo === 0 && velocidade < 0.5) {
      velocidade = 0;
      raf = null;
      return;
    }
    raf = requestAnimationFrame(quadro);
  }

  function estadoDisco(estado) {
    record.dataset.state = estado; // idle | ready | working | done
  }

  function corDoVinil(kbps) {
    record.style.setProperty('--vinyl-current', `var(--vinyl-${kbps})`);
  }

  function capaDoDisco(thumb) {
    const sleeve = $('sleeve');
    const labelDisc = document.querySelector('.label-disc');
    const sleeveImg = $('sleeveImg');
    const labelImg = $('labelImg');
    sleeve.classList.remove('has-image');
    labelDisc.classList.remove('has-image');
    if (!thumb) {
      sleeveImg.removeAttribute('src');
      labelImg.removeAttribute('src');
      return;
    }
    sleeveImg.onload = () => sleeve.classList.add('has-image');
    labelImg.onload = () => labelDisc.classList.add('has-image');
    sleeveImg.src = thumb;
    labelImg.src = thumb;
  }

  function legenda(titulo, meta) {
    $('captionTitle').textContent = titulo;
    $('captionMeta').textContent = meta;
  }

  function discoVazio() {
    estadoDisco('idle');
    capaDoDisco('');
    legenda('Nenhum disco no prato', 'Cole um link para começar');
  }

  form.querySelectorAll('input[name="qualidade"]').forEach((r) =>
    r.addEventListener('change', () => corDoVinil(r.value)),
  );
  corDoVinil(qualidadeAtual());

  /* ================= Campo de link ================= */

  function marcarCampo(estado, mensagem) {
    urlBox.classList.toggle('is-invalid', estado === 'erro');
    urlHint.classList.toggle('is-error', estado === 'erro');
    urlHint.classList.toggle('is-ok', estado === 'ok');
    urlHint.textContent = mensagem || HINT_PADRAO;
    urlInput.setAttribute('aria-invalid', estado === 'erro' ? 'true' : 'false');
  }

  pasteBtn.addEventListener('click', async () => {
    try {
      const texto = (await navigator.clipboard.readText()).trim();
      if (!texto) return toast('A área de transferência está vazia.', 'erro');
      urlInput.value = texto;
      urlInput.focus();
      aoMudarLink(true);
    } catch {
      toast('Não consegui ler a área de transferência. Use Ctrl+V.', 'erro');
      urlInput.focus();
    }
  });

  let timerLink = null;
  urlInput.addEventListener('input', () => {
    atualizarBotaoLimpar();
    clearTimeout(timerLink);
    timerLink = setTimeout(() => aoMudarLink(false), 450);
  });
  urlInput.addEventListener('paste', () => {
    clearTimeout(timerLink);
    setTimeout(() => aoMudarLink(true), 0);
  });

  /* Botão "X": limpa o link, a prévia e a capa do disco */
  const clearBtn = $('clearBtn');

  function atualizarBotaoLimpar() {
    clearBtn.hidden = !urlInput.value;
  }

  function limparLink() {
    clearTimeout(timerLink);
    urlInput.value = '';
    aoMudarLink(false);
    urlInput.focus();
  }

  clearBtn.addEventListener('click', limparLink);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && urlInput.value) {
      e.preventDefault();
      limparLink();
    }
  });

  function aoMudarLink(imediato) {
    atualizarBotaoLimpar();
    const url = urlInput.value.trim();
    if (!url) {
      marcarCampo('neutro');
      esquecerVideo();
      return;
    }
    if (!linkValido(url)) {
      if (imediato || /^https?:\/\/\S+\.\S+/.test(url)) {
        marcarCampo('erro', 'Esse não parece um link do YouTube. Confira e cole de novo.');
      } else {
        marcarCampo('neutro');
      }
      esquecerVideo();
      return;
    }
    carregarPrevia(url);
  }

  /* ================= Prévia: o vídeo vira a capa ================= */

  let videoAtual = null;
  let ultimaPreviaPedida = '';

  function esquecerVideo() {
    videoAtual = null;
    ultimaPreviaPedida = '';
    record.classList.remove('is-loading');
    if (record.dataset.state !== 'working' && result.hidden) discoVazio();
    atualizarTamanhos();
  }

  async function carregarPrevia(url) {
    if (url === ultimaPreviaPedida) return;
    ultimaPreviaPedida = url;

    marcarCampo('ok', 'Lendo o link…');
    record.classList.add('is-loading');
    legenda('Lendo o link…', '');

    try {
      const info = await postJSON('/api/info', { url });
      if (url !== ultimaPreviaPedida) return;
      videoAtual = { ...info, url };
      record.classList.remove('is-loading');
      capaDoDisco(info.thumbnail);
      if (record.dataset.state !== 'working') estadoDisco('ready');
      legenda(info.titulo, [info.canal, formatarDuracao(info.duracao)].filter(Boolean).join(' · '));
      marcarCampo('ok', 'Vídeo encontrado. Escolha a prensagem e converta.');
      atualizarTamanhos();
    } catch (e) {
      if (url !== ultimaPreviaPedida) return;
      record.classList.remove('is-loading');
      videoAtual = null;
      discoVazio();
      marcarCampo('erro', e.message);
      atualizarTamanhos();
    }
  }

  function atualizarTamanhos() {
    const duracao = videoAtual?.duracao || 0;
    form.querySelectorAll('.pressing-size').forEach((el) => {
      el.textContent = duracao ? `≈ ${formatarMB(tamanhoEstimado(Number(el.dataset.kbps), duracao))}` : '';
    });
  }

  /* ================= Etapas e progresso ================= */

  const ETAPAS = ['iniciando', 'baixando', 'convertendo', 'concluido'];
  const DETALHES = {
    iniciando: 'Conectando ao YouTube',
    baixando: 'Baixando o áudio',
    convertendo: 'Convertendo para MP3',
    concluido: 'Pronto',
  };

  function setProgresso(pct) {
    record.style.setProperty('--p', String(pct));
    $('progressPct').textContent = String(pct);
    $('meter').setAttribute('aria-valuenow', String(pct));
  }

  function setEtapa(status) {
    const atual = ETAPAS.indexOf(status);
    steps.querySelectorAll('li').forEach((li, i) => {
      const feita = i < atual || status === 'concluido';
      li.classList.toggle('is-done', feita);
      li.classList.toggle('is-active', i === atual && !feita);
      if (i === atual) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    $('stepStatus').textContent = DETALHES[status] || '';
    if (status !== 'concluido') {
      $('captionMeta').textContent = DETALHES[status] || '';
    }
  }

  /* ================= Download ================= */

  let polling = null;
  let ultimoPedido = null;

  function travarFormulario(travado) {
    goBtn.disabled = travado;
    urlInput.disabled = travado;
    pasteBtn.disabled = travado;
    clearBtn.disabled = travado;
    form.querySelectorAll('input[name="qualidade"]').forEach((r) => (r.disabled = travado));
    goLabel.textContent = travado ? 'Prensando o disco…' : BOTAO_PADRAO;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) {
      marcarCampo('erro', 'Cole um link do YouTube primeiro.');
      urlInput.focus();
      return;
    }
    if (!linkValido(url)) {
      marcarCampo('erro', 'Esse não parece um link do YouTube. Confira e cole de novo.');
      urlInput.focus();
      return;
    }
    iniciarDownload(url, qualidadeAtual());
  });

  async function iniciarDownload(url, qualidade) {
    ultimoPedido = { url, qualidade };
    errorBox.hidden = true;
    result.hidden = true;
    pararPlayer();
    travarFormulario(true);
    corDoVinil(qualidade);

    steps.hidden = false;
    estadoDisco('working');
    girar(true);
    setProgresso(0);
    setEtapa('iniciando');
    if (!videoAtual) legenda('Preparando…', DETALHES.iniciando);

    try {
      const { job_id } = await postJSON('/api/baixar', { url, qualidade });
      clearInterval(polling);
      polling = setInterval(() => checarStatus(job_id), 800);
    } catch (e) {
      mostrarErro(e.message);
    }
  }

  async function checarStatus(jobId) {
    try {
      const resp = await fetch(`/api/status/${jobId}`);
      const job = await resp.json();
      if (!resp.ok) throw new Error(job.erro || 'Erro ao consultar status.');

      if (job.status === 'erro') {
        mostrarErro(job.erro || 'Erro desconhecido durante o download.');
        return;
      }

      setProgresso(job.progress || 0);
      setEtapa(job.status);

      if (job.status === 'concluido') {
        clearInterval(polling);
        concluir(jobId, job);
      }
    } catch (e) {
      mostrarErro(e.message);
    }
  }

  function mostrarErro(msg) {
    clearInterval(polling);
    travarFormulario(false);
    girar(false);
    steps.hidden = true;
    estadoDisco(videoAtual ? 'ready' : 'idle');
    if (!videoAtual) discoVazio();
    $('errorMsg').textContent = msg;
    errorBox.hidden = false;
    toast('A conversão falhou.', 'erro');
  }

  $('retryBtn').addEventListener('click', () => {
    if (ultimoPedido) iniciarDownload(ultimoPedido.url, ultimoPedido.qualidade);
  });

  /* ================= Resultado e player ================= */

  const audio = $('audio');
  const playBtn = $('playBtn');
  const seek = $('seek');
  const canvas = $('wave');
  let picos = null;
  let urlAudio = null;

  function concluir(jobId, job) {
    travarFormulario(false);
    girar(false);
    estadoDisco('done');
    setTimeout(() => (steps.hidden = true), 1200);

    const thumb = job.thumbnail || videoAtual?.thumbnail || '';
    const tamanho = job.tamanho || tamanhoEstimado(Number(job.qualidade), job.duracao || 0);
    capaDoDisco(thumb);
    legenda(
      job.titulo || job.filename,
      [`${job.qualidade} kbps`, formatarMB(tamanho), formatarDuracao(job.duracao)].filter(Boolean).join(' · '),
    );

    const link = $('resultLink');
    link.href = `/api/arquivo/${jobId}`;
    link.setAttribute('download', job.filename);
    $('resultSize').textContent = formatarMB(tamanho);

    result.hidden = false;
    carregarPlayer(jobId);
    toast('Disco prensado. Ouça a prévia ou salve o MP3.');

    adicionarAoHistorico({
      url: ultimoPedido?.url || '',
      titulo: job.titulo || job.filename,
      canal: job.canal || '',
      thumbnail: thumb,
      qualidade: job.qualidade,
      duracao: job.duracao || 0,
      quando: new Date().toISOString(),
    });
  }

  $('resultLink').addEventListener('click', () => toast('Download iniciado. Confira a pasta de downloads.'));

  $('againBtn').addEventListener('click', () => {
    pararPlayer();
    result.hidden = true;
    urlInput.value = '';
    atualizarBotaoLimpar();
    marcarCampo('neutro');
    videoAtual = null;
    ultimaPreviaPedida = '';
    discoVazio();
    atualizarTamanhos();
    urlInput.focus();
  });

  async function carregarPlayer(jobId) {
    playBtn.disabled = true;
    seek.disabled = true;
    $('waveLoading').hidden = false;
    picos = null;
    desenharOnda();

    try {
      const resp = await fetch(`/api/ouvir/${jobId}`);
      if (!resp.ok) throw new Error();
      const buffer = await resp.arrayBuffer();
      urlAudio = URL.createObjectURL(new Blob([buffer.slice(0)], { type: 'audio/mpeg' }));
      audio.src = urlAudio;

      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        picos = calcularPicos(await ctx.decodeAudioData(buffer), 120);
        ctx.close();
      }
    } catch {
      /* sem onda: o <audio> continua funcionando */
    } finally {
      $('waveLoading').hidden = true;
      playBtn.disabled = !audio.src;
      seek.disabled = !audio.src;
      desenharOnda();
    }
  }

  function calcularPicos(buffer, barras) {
    const dados = buffer.getChannelData(0);
    const passo = Math.floor(dados.length / barras);
    const out = new Array(barras);
    let maior = 0;
    for (let b = 0; b < barras; b++) {
      let pico = 0;
      for (let i = b * passo; i < (b + 1) * passo; i += 32) {
        const v = Math.abs(dados[i]);
        if (v > pico) pico = v;
      }
      out[b] = pico;
      if (pico > maior) maior = pico;
    }
    return out.map((v) => (maior ? v / maior : 0));
  }

  function desenharOnda() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const estilo = getComputedStyle(document.documentElement);
    const corTocada = estilo.getPropertyValue('--accent').trim();
    const corResto = estilo.getPropertyValue('--line-strong').trim();
    const barras = picos || new Array(120).fill(0.06);
    const w = width / barras.length;
    const progresso = audio.duration ? audio.currentTime / audio.duration : 0;

    barras.forEach((v, i) => {
      const h = Math.max(2, v * height);
      ctx.fillStyle = i / barras.length < progresso ? corTocada : corResto;
      // barras de baixo para cima, como um espectro
      ctx.fillRect(i * w, height - h, Math.max(1, w - 2), h);
    });
  }

  function atualizarTempo() {
    const total = audio.duration || 0;
    $('time').textContent = `${formatarDuracao(audio.currentTime) || '0:00'} / ${formatarDuracao(total) || '0:00'}`;
    if (total) seek.value = String((audio.currentTime / total) * 100);
    desenharOnda();
  }

  playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener('play', () => {
    playBtn.classList.add('is-playing');
    playBtn.setAttribute('aria-label', 'Pausar prévia');
    document.body.classList.add('is-playing');
    girar(true);
  });
  audio.addEventListener('pause', () => {
    playBtn.classList.remove('is-playing');
    playBtn.setAttribute('aria-label', 'Tocar prévia');
    document.body.classList.remove('is-playing');
    girar(false);
  });
  audio.addEventListener('timeupdate', atualizarTempo);
  audio.addEventListener('loadedmetadata', atualizarTempo);
  seek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
  });
  window.addEventListener('resize', desenharOnda);

  function pararPlayer() {
    audio.pause();
    if (urlAudio) URL.revokeObjectURL(urlAudio);
    urlAudio = null;
    audio.removeAttribute('src');
    audio.load();
    seek.value = '0';
    $('time').textContent = '0:00 / 0:00';
  }

  /* ================= Lado B: tracklist ================= */

  const CHAVE = 'djwaltin-historico';
  const MAX = 12;

  function lerHistorico() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE)) || [];
    } catch {
      return [];
    }
  }

  function salvarHistorico(lista) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAX)));
    } catch {
      /* sem localStorage: o histórico só não persiste */
    }
  }

  function adicionarAoHistorico(item) {
    const lista = lerHistorico().filter((i) => !(i.url === item.url && i.qualidade === item.qualidade));
    salvarHistorico([item, ...lista]);
    renderHistorico();
  }

  function el(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function renderHistorico() {
    const lista = lerHistorico();
    const ol = $('historyList');
    ol.replaceChildren();
    $('historyEmpty').hidden = lista.length > 0;
    $('clearHistory').hidden = lista.length === 0;

    lista.forEach((item, idx) => {
      const li = el('li', 'track');
      li.style.animationDelay = `${idx * 40}ms`;
      li.style.setProperty('--vinyl', `var(--vinyl-${item.qualidade})`);

      const no = el('span', 'track-no', String(idx + 1).padStart(2, '0'));
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      if (item.thumbnail) img.src = item.thumbnail;

      const corpo = el('div');
      corpo.style.minWidth = '0';
      corpo.append(el('p', 'track-title', item.titulo), el('p', 'track-sub', item.canal || '—'));

      const quando = new Date(item.quando).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const meta = el('span', 'track-meta mono');
      meta.append(el('span', 'track-dot'), `${item.qualidade} kbps · ${formatarDuracao(item.duracao) || '—'} · ${quando}`);

      const btn = el('button', 'text-btn mono', 'Converter de novo');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Converter de novo: ${item.titulo}`);
      btn.disabled = !item.url;
      btn.addEventListener('click', () => {
        urlInput.value = item.url;
        atualizarBotaoLimpar();
        const radio = form.querySelector(`input[name="qualidade"][value="${item.qualidade}"]`);
        if (radio) radio.checked = true;
        carregarPrevia(item.url);
        iniciarDownload(item.url, item.qualidade);
        $('converter').scrollIntoView({ behavior: reduzMovimento ? 'auto' : 'smooth', block: 'start' });
      });

      li.append(no, img, corpo, meta, btn);
      ol.appendChild(li);
    });
  }

  $('clearHistory').addEventListener('click', () => {
    salvarHistorico([]);
    renderHistorico();
    toast('Tracklist apagada.');
  });

  /* ================= Footer: código de barras ================= */

  (function codigoDeBarras() {
    const g = $('barcode');
    const semente = 'djwaltin-001';
    let x = 0;
    let i = 0;
    while (x < 118) {
      const c = semente.charCodeAt(i % semente.length) + i * 7;
      const w = (c % 3) + 1;
      if (i % 2 === 0) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', '0');
        r.setAttribute('width', String(w * 0.9));
        r.setAttribute('height', '28');
        r.setAttribute('fill', 'currentColor');
        g.appendChild(r);
      }
      x += w * 1.1;
      i++;
    }
  })();

  /* ================= Carrossel: laço contínuo ================= */

  // Duplica os itens: a animação anda -50% e recomeça sem emenda visível.
  // As cópias ficam fora da árvore de acessibilidade para não serem lidas duas vezes.
  (function duplicarCarrossel() {
    const track = $('erasTrack');
    if (!track || reduzMovimento) return;
    [...track.children].forEach((item) => {
      const copia = item.cloneNode(true);
      copia.setAttribute('aria-hidden', 'true');
      track.appendChild(copia);
    });
  })();

  /* ================= Hero: botão "Começar" ================= */

  $('ctaStart').addEventListener('click', (e) => {
    e.preventDefault();
    $('converter').scrollIntoView({ behavior: reduzMovimento ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => urlInput.focus({ preventScroll: true }), reduzMovimento ? 0 : 600);
  });

  /* ================= Início ================= */
  discoVazio();
  renderHistorico();
})();
