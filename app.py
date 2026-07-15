import os
import re
import shutil
import tempfile
import threading
import uuid
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file

import yt_dlp

app = Flask(__name__)

TEMP_ROOT = Path(tempfile.gettempdir()) / "yt2mp3-jobs"
TEMP_ROOT.mkdir(exist_ok=True)


JOBS = {}


def verificar_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def limpar_nome_arquivo(nome: str) -> str:
    nome = re.sub(r'[\\/:*?"<>|]', "_", nome)   
    nome = re.sub(r"\s+", " ", nome).strip()    
    nome = nome.rstrip(". ")                     
    return nome


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
    except yt_dlp.utils.DownloadError:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = "Não foi possível baixar. Verifique o link e tente novamente."
        return
    except Exception as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = f"Erro inesperado: {e}"
        return

    titulo_original = info_preview.get("title", "audio")
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

    except yt_dlp.utils.DownloadError:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = "Não foi possível baixar. Verifique o link e tente novamente."
        shutil.rmtree(pasta_job, ignore_errors=True)
    except Exception as e:
        JOBS[job_id]["status"] = "erro"
        JOBS[job_id]["erro"] = f"Erro inesperado: {e}"
        shutil.rmtree(pasta_job, ignore_errors=True)


@app.route("/")
def index():
    return render_template("index.html", ffmpeg_ok=verificar_ffmpeg())


@app.route("/api/baixar", methods=["POST"])
def baixar():
    if not verificar_ffmpeg():
        return jsonify({"erro": "FFmpeg não encontrado no sistema."}), 400

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    qualidade = str(data.get("qualidade", "192"))

    if not url:
        return jsonify({"erro": "Cole um link do YouTube primeiro."}), 400

    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "status": "iniciando",
        "progress": 0,
        "filename": None,
        "erro": None,
        "titulo": None,
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

    def limpar_depois():
        import time
        time.sleep(5)
        shutil.rmtree(pasta_job, ignore_errors=True)
        JOBS.pop(job_id, None)

    threading.Thread(target=limpar_depois, daemon=True).start()

    return resposta


if __name__ == "__main__":
    if not verificar_ffmpeg():
        print("⚠️  AVISO: FFmpeg não foi encontrado no PATH. A conversão para MP3 vai falhar.")
    print("\n  Servidor rodando em: http://localhost:5000\n")
    app.run(debug=True, port=5000)