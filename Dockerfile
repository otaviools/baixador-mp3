# Imagem do djwaltin para produção (Render): Python + FFmpeg + gunicorn.
FROM python:3.14-slim

# FFmpeg converte o áudio baixado pelo yt-dlp para MP3
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Dependências primeiro: a camada fica em cache enquanto o requirements.txt não muda
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Roda sem privilégios de root
RUN useradd --create-home djwaltin
USER djwaltin

EXPOSE 10000

# Um worker só: os jobs ficam na memória do processo (veja converter/jobs.py).
# As threads atendem a consulta de status e o player enquanto outra conversão roda.
CMD exec gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120
