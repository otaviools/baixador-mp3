"""Testes do backend. Rodar com: python -m unittest

O yt-dlp é simulado: os testes não acessam a internet nem o YouTube.
"""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yt_dlp

import app as server
from converter import conversion, youtube
from converter.jobs import JobRepository, Status
from converter.youtube import Video, VideoError

VIDEO = Video(id="abc", title="Faixa: teste ft. Fulano", channel="Canal", duration=19, thumbnail="https://img/x.jpg")


def fake_mp3(folder: Path, name: str = "faixa.mp3") -> Path:
    path = folder / name
    path.write_bytes(b"ID3" + b"\0" * 97)
    return path


class VideoTest(unittest.TestCase):
    def test_filename_replaces_forbidden_characters(self):
        self.assertEqual(VIDEO.filename, "Faixa_ teste ft. Fulano")

    def test_filename_has_a_length_limit(self):
        long_title = Video(id=None, title="a" * 500, channel="", duration=0, thumbnail="")
        self.assertEqual(len(long_title.filename), 200)

    def test_missing_metadata_uses_defaults(self):
        self.assertEqual(Video.from_metadata({}), Video(id=None, title="Sem título", channel="", duration=0, thumbnail=""))

    def test_friendly_message_recognizes_known_errors(self):
        error = Exception("ERROR: Private video")
        self.assertEqual(youtube.friendly_message(error, "default"), "Esse vídeo é privado ou restrito a membros.")
        self.assertEqual(youtube.friendly_message(Exception("??"), "default"), "default")

    def test_download_keeps_titles_with_a_dot(self):
        with mock.patch.object(yt_dlp, "YoutubeDL") as ydl:
            youtube.download_mp3("url", Path("/tmp/job/Faixa ft. Fulano"), "192", lambda _: None)
        options = ydl.call_args.args[0]
        self.assertTrue(options["outtmpl"].endswith("Faixa ft. Fulano.%(ext)s"))
        self.assertEqual(options["postprocessors"][0]["preferredquality"], "192")


class ConversionTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)
        patcher = mock.patch.object(conversion, "TEMP_DIR", self.folder)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = JobRepository()

    def fake_download(self, url, destination, quality, on_progress):
        on_progress({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
        on_progress({"status": "finished"})
        Path(f"{destination}.mp3").write_bytes(b"ID3" + b"\0" * 97)

    def test_successful_conversion_fills_the_job(self):
        job = self.repo.create("320")
        with mock.patch.object(youtube, "read_video", return_value=VIDEO), mock.patch.object(
            youtube, "download_mp3", side_effect=self.fake_download
        ):
            conversion._run(self.repo, job, "url")

        self.assertEqual(job.status, Status.DONE)
        self.assertEqual(job.progress, 100)
        self.assertEqual(job.filename, "Faixa_ teste ft. Fulano.mp3")
        self.assertEqual(job.size, 100)
        self.assertEqual((job.title, job.channel, job.duration), ("Faixa: teste ft. Fulano", "Canal", 19))
        self.assertIsNotNone(job.file)

    def test_video_error_becomes_the_message_and_deletes_the_folder(self):
        job = self.repo.create("192")
        with mock.patch.object(youtube, "read_video", return_value=VIDEO), mock.patch.object(
            youtube, "download_mp3", side_effect=VideoError("Vídeo indisponível.")
        ):
            conversion._run(self.repo, job, "url")

        self.assertEqual((job.status, job.error), (Status.FAILED, "Vídeo indisponível."))
        self.assertFalse(job.folder.exists())

    def test_download_progress_goes_up_to_90(self):
        job = self.repo.create("192")
        on_progress = conversion._track_progress(job)
        on_progress({"status": "downloading", "downloaded_bytes": 100, "total_bytes": 100})
        self.assertEqual((job.status, job.progress), (Status.DOWNLOADING, 90))
        on_progress({"status": "finished"})
        self.assertEqual((job.status, job.progress), (Status.CONVERTING, 92))


class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.repo = JobRepository()
        patcher = mock.patch.object(server, "jobs", self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_info_requires_a_link(self):
        response = self.client.post("/api/info", json={"url": "  "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json, {"erro": "Cole um link do YouTube primeiro."})

    def test_info_returns_the_preview_fields(self):
        with mock.patch.object(server, "read_video", return_value=VIDEO):
            response = self.client.post("/api/info", json={"url": "https://youtu.be/abc"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json,
            {"id": "abc", "titulo": "Faixa: teste ft. Fulano", "canal": "Canal", "duracao": 19, "thumbnail": "https://img/x.jpg"},
        )

    def test_info_turns_video_errors_into_422(self):
        with mock.patch.object(server, "read_video", side_effect=VideoError("Não encontrei esse vídeo.")):
            response = self.client.post("/api/info", json={"url": "https://youtu.be/x"})
        self.assertEqual((response.status_code, response.json["erro"]), (422, "Não encontrei esse vídeo."))

    def test_playlist_is_rejected(self):
        ydl = mock.MagicMock()
        ydl.__enter__.return_value.extract_info.return_value = {"_type": "playlist"}
        with mock.patch.object(yt_dlp, "YoutubeDL", return_value=ydl):
            response = self.client.post("/api/info", json={"url": "https://youtube.com/playlist?list=x"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("playlist", response.json["erro"])

    def test_download_validates_the_quality(self):
        with mock.patch.object(server, "ffmpeg_available", return_value=True):
            response = self.client.post("/api/baixar", json={"url": "https://youtu.be/x", "qualidade": "999"})
        self.assertEqual(response.status_code, 400)

    def test_download_requires_ffmpeg(self):
        with mock.patch.object(server, "ffmpeg_available", return_value=False):
            response = self.client.post("/api/baixar", json={"url": "https://youtu.be/x"})
        self.assertEqual((response.status_code, response.json["erro"]), (400, "FFmpeg não encontrado no sistema."))

    def test_download_starts_a_job(self):
        with mock.patch.object(server, "ffmpeg_available", return_value=True), mock.patch.object(
            conversion, "start", side_effect=lambda repo, url, quality: repo.create(quality)
        ):
            response = self.client.post("/api/baixar", json={"url": "https://youtu.be/x"})
        job = self.repo.get(response.json["job_id"])
        self.assertEqual(job.quality, "192")

    def test_status_of_unknown_job(self):
        self.assertEqual(self.client.get("/api/status/missing").status_code, 404)

    def test_status_does_not_expose_server_paths(self):
        job = self.repo.create("128")
        data = self.client.get(f"/api/status/{job.id}").json
        self.assertNotIn("folder", data)
        self.assertEqual(
            set(data),
            {"id", "status", "progress", "qualidade", "titulo", "canal", "duracao", "thumbnail", "filename", "tamanho", "erro"},
        )
        self.assertEqual((data["status"], data["progress"], data["qualidade"]), ("iniciando", 0, "128"))

    def test_file_and_listen_serve_the_finished_mp3(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        fake_mp3(folder)
        job = self.repo.create("192")
        job.folder, job.filename, job.status = folder, "faixa.mp3", Status.DONE

        with mock.patch.object(self.repo, "remove_later") as remove_later:
            download = self.client.get(f"/api/arquivo/{job.id}")
        self.assertEqual(download.status_code, 200)
        self.assertIn("attachment", download.headers["Content-Disposition"])
        remove_later.assert_called_once()

        listen = self.client.get(f"/api/ouvir/{job.id}", headers={"Range": "bytes=0-9"})
        self.assertEqual((listen.status_code, len(listen.data)), (206, 10))
        download.close()
        listen.close()

    def test_file_before_it_is_ready(self):
        job = self.repo.create("192")
        self.assertEqual(self.client.get(f"/api/arquivo/{job.id}").status_code, 400)


if __name__ == "__main__":
    unittest.main()
