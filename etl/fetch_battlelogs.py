"""Calcule nos propres stats à partir de l'API officielle Brawl Stars.

On lit le classement mondial (et éventuellement des pays), puis l'historique des
25 dernières parties de chaque joueur. Les parties sont dédoublonnées et cumulées
dans data/raw/battles.json pour que l'échantillon grossisse chaque nuit.

Variables d'environnement :
  BRAWLSTARS_API_KEY  clé de developer.brawlstars.com (obligatoire)
  BRAWLSTARS_API_BASE par défaut https://api.brawlstars.com/v1. Les clés officielles
                      sont liées à une IP ; depuis GitHub Actions, utilisez le proxy
                      RoyaleAPI : https://bsproxy.royaleapi.dev/v1 (IP à autoriser
                      sur la clé : 45.79.218.79).
  BATTLE_TYPES        types de parties retenus, par défaut "soloRanked,teamRanked"
  RANKING_REGIONS     par défaut "global" (ex. "global,fr,us,kr")
  MAX_PLAYERS         joueurs lus par région, par défaut 200
  KEEP_DAYS           historique conservé, par défaut 21 jours
"""
from __future__ import annotations

import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

from common import RAW, get_json, read_json, slug, write_json

BASE = os.environ.get("BRAWLSTARS_API_BASE", "https://api.brawlstars.com/v1").rstrip("/")
TYPES = set(os.environ.get("BATTLE_TYPES", "soloRanked,teamRanked").split(","))
REGIONS = os.environ.get("RANKING_REGIONS", "global").split(",")
MAX_PLAYERS = int(os.environ.get("MAX_PLAYERS", "200"))
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "21"))


def parse_time(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=timezone.utc)


def battle_record(item: dict, owner_tag: str) -> dict | None:
    b, ev = item.get("battle", {}), item.get("event", {})
    teams = b.get("teams")
    if b.get("type") not in TYPES or not teams or len(teams) != 2 or not ev.get("map"):
        return None
    result = b.get("result")
    if result not in ("victory", "defeat"):
        return None
    sides = [[(p["tag"], slug(p["brawler"]["name"])) for p in t] for t in teams]
    owner_side = next((i for i, t in enumerate(sides) if any(tag == owner_tag for tag, _ in t)), None)
    if owner_side is None:
        return None
    winner = owner_side if result == "victory" else 1 - owner_side
    tags = sorted(tag for t in sides for tag, _ in t)
    return {
        "key": item["battleTime"] + "|" + ",".join(tags),
        "time": item["battleTime"],
        "map": slug(ev["map"]),
        "mapName": ev["map"],
        "mode": ev.get("mode") or b.get("mode"),
        "teams": [[br for _, br in t] for t in sides],
        "winner": winner,
    }


def main() -> None:
    key = os.environ.get("BRAWLSTARS_API_KEY")
    if not key:
        print("BRAWLSTARS_API_KEY absente : étape ignorée.")
        return
    headers = {"Authorization": f"Bearer {key}"}
    store_path = RAW / "battles.json"
    store = {b["key"]: b for b in read_json(store_path, [])}
    before = len(store)

    tags: list[str] = []
    for region in REGIONS:
        try:
            r = get_json(f"{BASE}/rankings/{region}/players?limit={MAX_PLAYERS}", headers)
            tags += [p["tag"] for p in r.get("items", [])]
        except Exception as e:
            print(f"  classement {region} indisponible : {e}", file=sys.stderr)
    tags = list(dict.fromkeys(tags))
    print(f"Lecture de {len(tags)} historiques…")

    for i, tag in enumerate(tags):
        try:
            log = get_json(f"{BASE}/players/{urllib.parse.quote(tag)}/battlelog", headers, pause=0.05)
        except Exception as e:
            print(f"  {tag}: {e}", file=sys.stderr)
            continue
        for item in log.get("items", []):
            rec = battle_record(item, tag)
            if rec:
                store[rec["key"]] = rec
        if i % 50 == 0:
            print(f"  {i}/{len(tags)}")

    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    kept = [b for b in store.values() if parse_time(b["time"]) >= cutoff]
    write_json(store_path, kept)
    print(f"Parties : {len(kept)} conservées ({len(store) - before} nouvelles)")


if __name__ == "__main__":
    main()
