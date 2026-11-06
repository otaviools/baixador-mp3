"""Executa uma conversão em segundo plano e mantém o Job atualizado."""

import logging
import threading

from . import youtube
from .config import SECONDS_UNTIL_EXPIRY, TEMP_DIR
from .jobs import Job, JobRepository, Status

log = logging.getLogger(__name__)

# O download vai até 90%; o restante representa a conversão pelo FFmpeg
DOWNLOAD_END_PROGRESS = 90
CONVERTING_PROGRESS = 92


def start(repository: JobRepository, url: str, quality: str) -> Job:
    job = repository.create(quality)
    threading.Thread(target=_run, args=(repository, job, url), daemon=True).start()
    return job


def _run(repository: JobRepository, job: Job, url: str) -> None:
    try:
        video = youtube.read_video(url, default_error=youtube.DOWNLOAD_ERROR)
        job.title, job.channel = video.title, video.channel
        job.duration, job.thumbnail = video.duration, video.thumbnail

        job.folder = TEMP_DIR / job.id
        job.folder.mkdir(parents=True, exist_ok=True)
        youtube.download_mp3(url, job.folder / video.filename, job.quality, _track_progress(job))
    except youtube.VideoError as error:
        job.fail(str(error))
        return
    except Exception as error:  # noqa: BLE001 — qualquer falha precisa chegar à interface
        log.exception("Conversão %s falhou", job.id)
        job.fail(f"Erro inesperado: {error}")
        return

    job.filename = f"{video.filename}.mp3"
    path = job.folder / job.filename
    job.size = path.stat().st_size if path.exists() else None
    job.progress = 100
    job.status = Status.DONE  # por último: a interface só lê o resto quando vê "concluido"
    repository.remove_later(job.id, SECONDS_UNTIL_EXPIRY)


def _track_progress(job: Job):
    """Traduz os eventos de progresso do yt-dlp para o Job."""

    def on_progress(event: dict) -> None:
        if event.get("status") == "downloading":
            total = event.get("total_bytes") or event.get("total_bytes_estimate")
            if total:
                done = event.get("downloaded_bytes", 0) / total
                job.progress = max(job.progress, int(done * DOWNLOAD_END_PROGRESS))
            job.status = Status.DOWNLOADING
        elif event.get("status") == "finished":
            job.progress = CONVERTING_PROGRESS
            job.status = Status.CONVERTING

    return on_progress
