"""Assemble la base finale web/public/data/db.json.

Ordre conseillé (voir .github/workflows/update-data.yml) :
  python etl/fetch_brawlify.py
  python etl/fetch_battlelogs.py   # si BRAWLSTARS_API_KEY est définie
  python etl/build.py
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from aggregate import aggregate
from common import OUT, RAW, ROOT, read_json, write_json

OWN_WEIGHT_FULL = 400  # à partir de N parties sur une map, nos stats priment


def merge_stat(ext: dict | None, own: dict | None) -> dict:
    if not own:
        return ext
    if not ext:
        return own
    w = min(own["n"] / OWN_WEIGHT_FULL, 1.0)
    return {
        "winRate": round(w * own["winRate"] + (1 - w) * ext["winRate"], 2),
        "useRate": round(w * own.get("useRate", 0) + (1 - w) * ext.get("useRate", 0), 2),
        "n": own["n"] + 150,
    }


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"([a-z])([A-Z])", r"\1 \2", s or "").lower())


def translate_fr(maps, fr: dict) -> None:
    """Noms français pour les maps et les modes ; l'anglais reste un alias vocal."""
    modes = {_key(k): v for k, v in fr.get("modes", {}).items()}
    names = {_key(k): v for k, v in fr.get("maps", {}).items()}
    for m in maps:
        m["mode"] = modes.get(_key(m.get("mode", "")), m.get("mode", ""))
        fr_name = names.get(_key(m["name"]))
        if fr_name and fr_name != m["name"]:
            m["aliases"] = sorted(set(m.get("aliases", []) + [m["name"]]))
            m["name"] = fr_name


def main() -> None:
    bf = read_json(RAW / "brawlify.json", {}) or {}
    battles = read_json(RAW / "battles.json", []) or []
    own = aggregate(battles) if battles else {"maps": [], "mapStats": {}, "matchups": {}, "synergies": {}, "games": 0}
    aliases = read_json(ROOT / "data" / "aliases.json", {}) or {}

    brawlers = {b["id"]: b for b in bf.get("brawlers", [])}
    for bid in {br for b in battles for t in b["teams"] for br in t}:
        brawlers.setdefault(bid, {"id": bid, "name": bid.replace("-", " ").title()})
    for bid, al in aliases.get("brawlers", {}).items():
        if bid in brawlers:
            brawlers[bid]["aliases"] = al

    maps = {m["id"]: dict(m) for m in bf.get("maps", [])}
    for m in own["maps"]:  # le mode vu en classé prime sur celui de Brawlify
        maps.setdefault(m["id"], dict(m))["mode"] = m["mode"] or maps[m["id"]].get("mode", "")
    translate_fr(maps.values(), read_json(ROOT / "data" / "fr.json", {}) or {})
    for mid, al in aliases.get("maps", {}).items():
        if mid in maps:
            maps[mid]["aliases"] = sorted(set(maps[mid].get("aliases", []) + al))

    map_stats = {}
    for mid in set(bf.get("mapStats", {})) | set(own["mapStats"]):
        e, o = bf.get("mapStats", {}).get(mid, {}), own["mapStats"].get(mid, {})
        map_stats[mid] = {bid: merge_stat(e.get(bid), o.get(bid)) for bid in set(e) | set(o)}

    sources = []
    if bf:
        sources.append("Brawlify")
    if battles:
        sources.append(f"API officielle Brawl Stars ({own['games']} parties classées)")

    db = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": sources,
        "brawlers": sorted(brawlers.values(), key=lambda b: b["name"]),
        "maps": sorted(maps.values(), key=lambda m: (m["mode"], m["name"])),
        "activeMaps": bf.get("activeMaps", []),
        "mapStats": map_stats,
        "matchups": own["matchups"],
        "synergies": own["synergies"],
        "patches": read_json(ROOT / "data" / "patches.json", []) or [],
    }
    if not db["brawlers"]:
        raise SystemExit("Aucune donnée brute : lancez d'abord fetch_brawlify.py.")
    write_json(OUT, db)
    print(f"Base écrite : {len(db['brawlers'])} brawlers, {len(db['maps'])} maps, {len(map_stats)} maps avec stats")


if __name__ == "__main__":
    main()
