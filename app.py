"""Servidor web: rotas HTTP do conversor. A lógica fica no pacote `converter`.

Rotas e campos JSON ficam em português: são o contrato da API lido pela interface.
"""

import logging
import shutil

from flask import Flask, jsonify, render_template, request, send_file

from converter import conversion
from converter.config import DEFAULT_QUALITY, QUALITIES, SECONDS_AFTER_SAVE, TEMP_DIR
from converter.jobs import Job, JobRepository, Status
from converter.youtube import VideoError, read_video

# Logs no stderr: aparecem no terminal onde o python app.py está rodando
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
jobs = JobRepository()
TEMP_DIR.mkdir(exist_ok=True)


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@app.errorhandler(ApiError)
def handle_api_error(error: ApiError):
    return jsonify({"erro": str(error)}), error.status


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def request_body() -> dict:
    return request.get_json(silent=True) or {}


def require_url(body: dict) -> str:
    url = (body.get("url") or "").strip()
    if not url:
        raise ApiError("Cole um link do YouTube primeiro.")
    return url


def require_job(job_id: str) -> Job:
    job = jobs.get(job_id)
    if not job:
        raise ApiError("Job não encontrado.", 404)
    return job


def require_mp3(job_id: str) -> Job:
    job = jobs.get(job_id)
    if not job or job.status != Status.DONE:
        raise ApiError("Arquivo ainda não está pronto.")
    if not job.file:
        raise ApiError("Arquivo não encontrado no servidor.", 404)
    return job


@app.get("/")
def index():
    return render_template("Index.html", ffmpeg_ok=ffmpeg_available())


@app.post("/api/info")
def info():
    """Prévia: título, canal, duração e capa, sem baixar nada."""
    url = require_url(request_body())
    try:
        video = read_video(url)
    except VideoError as error:
        raise ApiError(str(error), 422) from error
    except Exception as error:  # noqa: BLE001
        log.exception("Falha inesperada ao ler %s", url)
        raise ApiError("Não foi possível ler esse link.", 422) from error
    return jsonify(video.to_json())


@app.post("/api/baixar")
def download():
    if not ffmpeg_available():
        raise ApiError("FFmpeg não encontrado no sistema.")

    body = request_body()
    url = require_url(body)
    quality = str(body.get("qualidade", DEFAULT_QUALITY))
    if quality not in QUALITIES:
        raise ApiError("Qualidade inválida. Use 128, 192 ou 320 kbps.")

    job = conversion.start(jobs, url, quality)
    return jsonify({"job_id": job.id})


@app.get("/api/status/<job_id>")
def status(job_id: str):
    return jsonify(require_job(job_id).to_json())


@app.get("/api/arquivo/<job_id>")
def file(job_id: str):
    """Entrega o MP3 como download e agenda a limpeza."""
    job = require_mp3(job_id)
    response = send_file(job.file, as_attachment=True, download_name=job.filename, mimetype="audio/mpeg")
    jobs.remove_later(job.id, SECONDS_AFTER_SAVE)
    return response


@app.get("/api/ouvir/<job_id>")
def listen(job_id: str):
    """Entrega o MP3 para o player da página (aceita Range para avançar)."""
    job = require_mp3(job_id)
    return send_file(job.file, mimetype="audio/mpeg", conditional=True)


if __name__ == "__main__":
    if not ffmpeg_available():
        print("AVISO: FFmpeg não foi encontrado no PATH. A conversão para MP3 vai falhar.")
    print("\n  Servidor rodando em: http://localhost:5000\n")
    app.run(debug=True, port=5000)
