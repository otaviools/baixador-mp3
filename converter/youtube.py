"""Integração com o yt-dlp: metadados do vídeo e download em MP3."""

import logging
import re
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import yt_dlp

from . import config
from .config import MAX_FILENAME_LENGTH

log = logging.getLogger(__name__)


class _YtDlpLogger:
    """Encaminha avisos e erros do yt-dlp para o log do servidor (Render → Logs).

    É por aviso que o yt-dlp conta, por exemplo, que os cookies não são mais válidos.
    As mensagens de progresso (debug) ficam de fora para não poluir o log.
    """

    _log = logging.getLogger("yt_dlp")

    def debug(self, message: str) -> None:
        pass

    def info(self, message: str) -> None:
        pass

    def warning(self, message: str) -> None:
        self._log.warning(message)

    def error(self, message: str) -> None:
        self._log.error(message)


BASE_OPTIONS = {"quiet": True, "noplaylist": True, "logger": _YtDlpLogger()}

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
    # A interface só vê o texto amigável; o erro original fica no log do servidor (Render → Logs)
    log.warning("yt-dlp falhou: %s", error)
    text = str(error)
    for fragments, message in ERROR_MESSAGES:
        if any(fragment in text for fragment in fragments):
            return message
    return default


NETSCAPE_HEADERS = ("# Netscape HTTP Cookie File", "# HTTP Cookie File")
COOKIE_FIELDS = 7  # domínio, subdomínios, caminho, https, validade, nome, valor


def normalize_cookies(text: str) -> str:
    """Conserta estragos comuns de copiar e colar o arquivo de cookies (formato Netscape).

    - remove o BOM que o Bloco de Notas coloca no início;
    - troca quebras de linha do Windows (CRLF) por LF;
    - devolve as tabulações quando viraram espaços (ex.: ao colar no painel do Render);
    - acrescenta o cabeçalho "# Netscape HTTP Cookie File" quando ele falta.
    """
    lines = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    fixed = []
    for line in lines:
        stripped = line.strip()
        is_cookie = stripped and (not stripped.startswith("#") or stripped.startswith("#HttpOnly_"))
        if is_cookie and "\t" not in stripped and len(stripped.split()) == COOKIE_FIELDS:
            line = "\t".join(stripped.split())
        fixed.append(line)

    body = "\n".join(fixed).strip()
    if not body.startswith(NETSCAPE_HEADERS):
        body = f"{NETSCAPE_HEADERS[0]}\n{body}"
    return body + "\n"


@contextmanager
def _youtube_dl(options: dict) -> Iterator[yt_dlp.YoutubeDL]:
    """Abre o yt-dlp com as opções base e, se houver, com os cookies do YouTube.

    O yt-dlp regrava o arquivo de cookies ao terminar, mas o original pode ser somente
    leitura (Secret File do Render). Por isso cada uso trabalha numa cópia própria,
    já normalizada e apagada no fim; isso também evita duas conversões gravando o mesmo arquivo.
    O conteúdo dos cookies nunca vai para o log: eles valem como senha da conta.
    """
    with tempfile.TemporaryDirectory(prefix="yt2mp3-cookies-") as folder:
        if config.COOKIES_FILE.is_file():
            original = config.COOKIES_FILE.read_text(encoding="utf-8", errors="replace")
            cookies = normalize_cookies(original)
            log.info(
                "Usando cookies do YouTube de %s (%d linhas%s)",
                config.COOKIES_FILE,
                cookies.count("\n"),
                ", formato corrigido" if cookies != original else "",
            )
            copy = Path(folder) / "cookies.txt"
            copy.write_text(cookies, encoding="utf-8")
            options = {**options, "cookiefile": str(copy)}
        with yt_dlp.YoutubeDL({**BASE_OPTIONS, **options}) as ydl:
            yield ydl


def read_video(url: str, default_error: str = READ_ERROR) -> Video:
    """Lê os metadados do vídeo sem baixar nada."""
    try:
        with _youtube_dl({"skip_download": True}) as ydl:
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
        "format": "bestaudio/best",
        # Concatena em vez de with_suffix: títulos com ponto ("ft. X") não podem perder o fim
        "outtmpl": f"{destination}.%(ext)s",
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": quality},
        ],
        "progress_hooks": [on_progress],
    }
    try:
        with _youtube_dl(options) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as error:
        raise VideoError(friendly_message(error, DOWNLOAD_ERROR)) from error
