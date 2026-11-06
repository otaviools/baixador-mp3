"""Integração com o yt-dlp: metadados do vídeo e download em MP3."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yt_dlp

from .config import MAX_FILENAME_LENGTH

BASE_OPTIONS = {"quiet": True, "no_warnings": True, "noplaylist": True}

# Trecho da mensagem do yt-dlp → texto amigável para a interface
ERROR_MESSAGES = (
    (("403", "Forbidden"), "O YouTube recusou o download. Atualize a biblioteca: pip install -U yt-dlp"),
    (("Private video", "members-only"), "Esse vídeo é privado ou restrito a membros."),
    (("Video unavailable", "not available"), "Vídeo indisponível. Pode ter sido removido ou bloqueado na sua região."),
    (("Sign in to confirm", "bot"), "O YouTube pediu verificação de que você não é um robô. Tente novamente em alguns minutos."),
)
DOWNLOAD_ERROR = "Não foi possível baixar. Verifique o link e tente novamente."
READ_ERROR = "Não encontrei esse vídeo. Confira o link e tente de novo."
PLAYLIST_ERROR = "Links de playlist não são aceitos. Cole o link de um vídeo só."


class VideoError(Exception):
    """Falha esperada ao ler ou baixar um vídeo; a mensagem já é amigável."""


@dataclass(frozen=True)
class Video:
    id: str | None
    title: str
    channel: str
    duration: int
    thumbnail: str

    @classmethod
    def from_metadata(cls, meta: dict) -> "Video":
        return cls(
            id=meta.get("id"),
            title=meta.get("title") or "Sem título",
            channel=meta.get("uploader") or meta.get("channel") or "",
            duration=int(meta.get("duration") or 0),
            thumbnail=meta.get("thumbnail") or "",
        )

    @property
    def filename(self) -> str:
        """Título seguro para usar como nome de arquivo no Windows, macOS e Linux."""
        name = re.sub(r'[\\/:*?"<>|]', "_", self.title)
        name = re.sub(r"\s+", " ", name).strip().rstrip(". ")
        return name[:MAX_FILENAME_LENGTH]

    def to_json(self) -> dict:
        """Campos da prévia enviados para a interface."""
        return {
            "id": self.id,
            "titulo": self.title,
            "canal": self.channel,
            "duracao": self.duration,
            "thumbnail": self.thumbnail,
        }


def friendly_message(error: Exception, default: str) -> str:
    text = str(error)
    for fragments, message in ERROR_MESSAGES:
        if any(fragment in text for fragment in fragments):
            return message
    return default


def read_video(url: str, default_error: str = READ_ERROR) -> Video:
    """Lê os metadados do vídeo sem baixar nada."""
    try:
        with yt_dlp.YoutubeDL({**BASE_OPTIONS, "skip_download": True}) as ydl:
            meta = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as error:
        raise VideoError(friendly_message(error, default_error)) from error

    if meta.get("_type") == "playlist":
        raise VideoError(PLAYLIST_ERROR)
    return Video.from_metadata(meta)


def download_mp3(
    url: str,
    destination: Path,
    quality: str,
    on_progress: Callable[[dict], None],
) -> None:
    """Baixa o melhor áudio disponível e converte para MP3 com o FFmpeg."""
    options = {
        **BASE_OPTIONS,
        "format": "bestaudio/best",
        # Concatena em vez de with_suffix: títulos com ponto ("ft. X") não podem perder o fim
        "outtmpl": f"{destination}.%(ext)s",
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": quality},
        ],
        "progress_hooks": [on_progress],
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as error:
        raise VideoError(friendly_message(error, DOWNLOAD_ERROR)) from error
