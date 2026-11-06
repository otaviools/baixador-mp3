import tempfile
from pathlib import Path

TEMP_DIR = Path(tempfile.gettempdir()) / "yt2mp3-jobs"

QUALITIES = frozenset({"128", "192", "320"})
DEFAULT_QUALITY = "192"

# Depois de salvo, o MP3 continua disponível um pouco para o player da página
SECONDS_AFTER_SAVE = 120
# Conversões que nunca foram salvas expiram depois disso
SECONDS_UNTIL_EXPIRY = 30 * 60

MAX_FILENAME_LENGTH = 200
