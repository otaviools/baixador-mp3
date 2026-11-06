"""Estado das conversões em andamento, guardado em memória."""

import shutil
import threading
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path


class Status(StrEnum):
    # Os valores fazem parte da API lida pela interface
    STARTING = "iniciando"
    DOWNLOADING = "baixando"
    CONVERTING = "convertendo"
    DONE = "concluido"
    FAILED = "erro"


@dataclass
class Job:
    quality: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: Status = Status.STARTING
    progress: int = 0
    title: str | None = None
    channel: str | None = None
    duration: int | None = None
    thumbnail: str | None = None
    filename: str | None = None
    size: int | None = None
    error: str | None = None
    folder: Path | None = None

    @property
    def file(self) -> Path | None:
        """Caminho do MP3 pronto, ou None enquanto ele não existe."""
        if self.status != Status.DONE or not (self.folder and self.filename):
            return None
        path = self.folder / self.filename
        return path if path.exists() else None

    def fail(self, message: str) -> None:
        self.status = Status.FAILED
        self.error = message
        delete_folder(self.folder)

    def to_json(self) -> dict:
        """Campos enviados para a interface (nunca os caminhos do servidor)."""
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "qualidade": self.quality,
            "titulo": self.title,
            "canal": self.channel,
            "duracao": self.duration,
            "thumbnail": self.thumbnail,
            "filename": self.filename,
            "tamanho": self.size,
            "erro": self.error,
        }


def delete_folder(folder: Path | None) -> None:
    if folder:
        shutil.rmtree(folder, ignore_errors=True)


class JobRepository:
    """Guarda os jobs em memória e apaga os arquivos depois de um prazo."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, quality: str) -> Job:
        job = Job(quality=quality)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def remove_later(self, job_id: str, seconds: float) -> None:
        timer = threading.Timer(seconds, self._remove, args=(job_id,))
        timer.daemon = True
        timer.start()

    def _remove(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job:
            delete_folder(job.folder)
