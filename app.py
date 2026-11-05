import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file

import yt_dlp

app = Flask(__name__)

TEMP_ROOT = Path(tempfile.gettempdir()) / "yt2mp3-jobs"
TEMP_ROOT.mkdir(exist_ok=True)


JOBS = {}

QUALIDADES = {"128", "192", "320"}
# Depois de salvar, o arquivo fica disponível mais um pouco para o player da página
SEGUNDOS_APOS_SALVAR = 120
# Arquivos convertidos que nunca foram salvos expiram depois disso
SEGUNDOS_EXPIRACAO = 30 * 60


def verificar_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def limpar_nome_arquivo(nome: str) -> str:
    nome = re.sub(r'[\\/:*?"<>|]', "_", nome)   
    nome = re.sub(r"\s+", " ", nome).strip()    
    nome = nome.rstrip(". ")                     
    return nome


def mensagem_erro_download(erro: Exception) -> str:
    msg = str(erro)
    if "403" in msg or "Forbidden" in msg:
        return "O YouTube recusou o download. Atualize a biblioteca: pip install -U yt-dlp"
    if "Private video" in msg or "members-only" in msg:
        return "Esse vídeo é privado ou restrito a membros."
    if "Video unavailable" in msg or "not available" in msg:
        return "Vídeo indisponível. Pode ter sido removido ou bloqueado na sua região."
    if "Sign in to confirm" in msg or "bot" in msg:
        return "O YouTube pediu verificação de que você não é um robô. Tente novamente em alguns minutos."
    return "Não foi possível baixar. Verifique o link e tente novamente."


def resumo_video(meta: dict) -> dict:
    """Campos do vídeo que a interface usa na prévia, no resultado e no histórico."""
    return {
        "id": meta.get("id"),
        "titulo": meta.get("title") or "Sem título",
        "canal": meta.get("uploader") or meta.get("channel") or "",
        "duracao": int(meta.get("duration") or 0),
        "thumbnail": meta.get("thumbnail") or "",
    }


def agendar_limpeza(job_id: str, segundos: int):
    """Apaga a pasta do job e o registro dele depois de alguns segundos, em segundo plano."""

    def limpar():
        time.sleep(segundos)
        job = JOBS.pop(job_id, None)
        if job and job.get("pasta"):
            shutil.rmtree(job["pasta"], ignore_errors=True)

    threading.Thread(target=limpar, daemon=True).start()


def progress_hook_factory(job_id):
    def hook(d):
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            baixado = d.get("downloaded_bytes", 0)
            if total:
                pct = int(baixado / total * 90)
            else:
                pct = JOBS[job_id]["progress"]
            JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], pct)
            JOBS[job_id]["status"] = "baixando"
        elif status == "finished":
            JOBS[job_id]["progress"] = 92
            JOBS[job_id]["status"] = "convertendo"

    return hook


def executar_download(job_id: str, url: str, qualidade: str):
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
            info_preview = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = mensagem_erro_download(e)
        return
    except Exception as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = f"Erro inesperado: {e}"
        return

    titulo_original = info_preview.get("title", "audio")
    resumo = resumo_video(info_preview)
    JOBS[job_id].update(canal=resumo["canal"], duracao=resumo["duracao"], thumbnail=resumo["thumbnail"])
    nome_seguro = limpar_nome_arquivo(titulo_original)[:200]
    pasta_job = TEMP_ROOT / job_id
    pasta_job.mkdir(parents=True, exist_ok=True)
    JOBS[job_id]["pasta"] = str(pasta_job)

    opcoes = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": qualidade,
            }
        ],
        "outtmpl": str(pasta_job / f"{nome_seguro}.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook_factory(job_id)],
    }

    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            ydl.download([url])

        final_name = f"{nome_seguro}.mp3"

        JOBS[job_id]["status"] = "concluido"
        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["filename"] = final_name
        JOBS[job_id]["titulo"] = titulo_original
        caminho_final = pasta_job / final_name
        JOBS[job_id]["tamanho"] = caminho_final.stat().st_size if caminho_final.exists() else None
        agendar_limpeza(job_id, SEGUNDOS_EXPIRACAO)

    except yt_dlp.utils.DownloadError as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = mensagem_erro_download(e)
        shutil.rmtree(pasta_job, ignore_errors=True)
    except Exception as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = f"Erro inesperado: {e}"
        shutil.rmtree(pasta_job, ignore_errors=True)


@app.route("/")
def index():
    return render_template("index.html", ffmpeg_ok=verificar_ffmpeg())


@app.route("/api/info", methods=["POST"])
def info():
    """Lê título, canal, duração e capa do vídeo sem baixar nada (prévia da interface)."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"erro": "Cole um link do YouTube primeiro."}), 400

    opcoes = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            meta = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        msg = mensagem_erro_download(e)
        if msg.startswith("Não foi possível baixar"):
            msg = "Não encontrei esse vídeo. Confira o link e tente de novo."
        return jsonify({"erro": msg}), 422
    except Exception:
        return jsonify({"erro": "Não foi possível ler esse link."}), 422

    if meta.get("_type") == "playlist":
        return jsonify({"erro": "Links de playlist não são aceitos. Cole o link de um vídeo só."}), 422

    return jsonify(resumo_video(meta))


@app.route("/api/baixar", methods=["POST"])
def baixar():
    if not verificar_ffmpeg():
        return jsonify({"erro": "FFmpeg não encontrado no sistema."}), 400

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    qualidade = str(data.get("qualidade", "192"))

    if not url:
        return jsonify({"erro": "Cole um link do YouTube primeiro."}), 400
    if qualidade not in QUALIDADES:
        return jsonify({"erro": "Qualidade inválida. Use 128, 192 ou 320 kbps."}), 400

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "iniciando",
        "progress": 0,
        "filename": None,
        "erro": None,
        "titulo": None,
        "canal": None,
        "duracao": None,
        "thumbnail": None,
        "tamanho": None,
        "qualidade": qualidade,
        "pasta": None,
    }

    thread = threading.Thread(target=executar_download, args=(job_id, url, qualidade), daemon=True)
    thread.start()

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def status(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"erro": "Job não encontrado."}), 404
    job_publico = {k: v for k, v in job.items() if k != "pasta"}
    return jsonify(job_publico)

@app.route("/api/arquivo/<job_id>")
def arquivo(job_id):
    job = JOBS.get(job_id)
    if not job or job.get("status") != "concluido":
        return jsonify({"erro": "Arquivo ainda não está pronto."}), 400

    pasta_job = Path(job["pasta"])
    caminho_arquivo = pasta_job / job["filename"]

    if not caminho_arquivo.exists():
        return jsonify({"erro": "Arquivo não encontrado no servidor."}), 404

    resposta = send_file(
        caminho_arquivo,
        as_attachment=True,
        download_name=job["filename"],
        mimetype="audio/mpeg",
    )

    # Mantém o arquivo um pouco para o player da página continuar tocando
    agendar_limpeza(job_id, SEGUNDOS_APOS_SALVAR)

    return resposta


@app.route("/api/ouvir/<job_id>")
def ouvir(job_id):
    """Serve o MP3 para o player da página (sem forçar download; aceita Range para avançar)."""
    job = JOBS.get(job_id)
    if not job or job.get("status") != "concluido":
        return jsonify({"erro": "Arquivo ainda não está pronto."}), 400

    caminho_arquivo = Path(job["pasta"]) / job["filename"]
    if not caminho_arquivo.exists():
        return jsonify({"erro": "Arquivo não encontrado no servidor."}), 404

    return send_file(caminho_arquivo, mimetype="audio/mpeg", conditional=True)


if __name__ == "__main__":
    if not verificar_ffmpeg():
        print("⚠️  AVISO: FFmpeg não foi encontrado no PATH. A conversão para MP3 vai falhar.")
    print("\n  Servidor rodando em: http://localhost:5000\n")
    app.run(debug=True, port=5000)