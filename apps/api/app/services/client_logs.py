import json
from pathlib import Path
from threading import Lock
from typing import Any


class ClientLogWriter:
    def __init__(
        self,
        path: Path | str,
        *,
        max_bytes: int = 5_000_000,
        backup_count: int = 3,
    ) -> None:
        self._path = Path(path)
        self._max_bytes = max_bytes
        self._backup_count = backup_count
        self._lock = Lock()

    def write(self, record: dict[str, Any]) -> None:
        line = f"{json.dumps(record, ensure_ascii=True, sort_keys=True)}\n"
        encoded_size = len(line.encode("utf-8"))
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            if (
                self._path.exists()
                and self._path.stat().st_size + encoded_size > self._max_bytes
            ):
                self._rotate()
            with self._path.open("a", encoding="utf-8") as log_file:
                log_file.write(line)

    def _rotate(self) -> None:
        if self._backup_count <= 0:
            self._path.unlink(missing_ok=True)
            return
        Path(f"{self._path}.{self._backup_count}").unlink(missing_ok=True)
        for index in range(self._backup_count - 1, 0, -1):
            source = Path(f"{self._path}.{index}")
            if source.exists():
                source.replace(Path(f"{self._path}.{index + 1}"))
        self._path.replace(Path(f"{self._path}.1"))
