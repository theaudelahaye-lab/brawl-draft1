"""Outils partagés du pipeline : HTTP avec reprise, slugs, chemins."""
from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "public" / "data" / "db.json"
USER_AGENT = "brawl-draft-coach/0.1 (projet personnel non commercial)"


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def pretty(name: str) -> str:
    """'EL PRIMO' -> 'El Primo' ; garde les noms déjà en casse mixte."""
    if name.isupper():
        return " ".join(w.capitalize() for w in re.split(r"[\s-]+", name))
    return name.replace("-", " ")


def get_json(url: str, headers: dict | None = None, retries: int = 4, pause: float = 0.0):
    h = {"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            if pause:
                time.sleep(pause)
            return data
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Échec après {retries} essais : {url} ({last})")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))
