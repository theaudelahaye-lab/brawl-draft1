"""Récupère brawlers, maps et stats par map depuis l'API publique de Brawlify.

Brawlify demande de citer la source : le nom apparaît dans le pied de page de l'appli.
Sortie : data/raw/brawlify.json
"""
from __future__ import annotations

from common import RAW, get_json, pretty, slug, write_json

BASE = "https://api.brawlapi.com/v1"


def _list(payload):
    return payload.get("list", payload) if isinstance(payload, dict) else payload


def main() -> None:
    brawlers_raw = _list(get_json(f"{BASE}/brawlers"))
    id_to_slug: dict[int, str] = {}
    brawlers = []
    for b in brawlers_raw:
        name = b.get("name", "")
        sid = slug(b.get("hash") or name)
        id_to_slug[b["id"]] = sid
        brawlers.append({
            "id": sid,
            "name": pretty(b.get("hash") or name),
            "className": (b.get("class") or {}).get("name"),
        })

    maps_raw = _list(get_json(f"{BASE}/maps"))
    maps, map_stats = [], {}
    for m in maps_raw:
        if m.get("disabled"):
            continue
        mode = (m.get("gameMode") or {}).get("name") or ""
        mid = slug(m.get("hash") or m["name"])
        maps.append({"id": mid, "name": m["name"], "mode": mode})
        stats = m.get("stats")
        if stats is None:  # certaines versions de l'API ne détaillent les stats que par map
            try:
                stats = get_json(f"{BASE}/maps/{m['id']}", pause=0.2).get("stats", [])
            except Exception as e:  # une map absente ne doit pas tout casser
                print(f"  stats indisponibles pour {m['name']}: {e}")
                stats = []
        per = {}
        for s in stats:
            bid = id_to_slug.get(s.get("brawler"))
            if bid and s.get("winRate") is not None:
                per[bid] = {"winRate": float(s["winRate"]), "useRate": float(s.get("useRate") or 0)}
        if per:
            map_stats[mid] = per

    try:
        events = _list(get_json(f"{BASE}/events").get("active", []))
        active = [slug(e["map"].get("hash") or e["map"]["name"]) for e in events if e.get("map")]
    except Exception:
        active = []

    write_json(RAW / "brawlify.json", {
        "brawlers": brawlers, "maps": maps, "mapStats": map_stats, "activeMaps": active,
    })
    print(f"Brawlify : {len(brawlers)} brawlers, {len(maps)} maps, stats pour {len(map_stats)} maps")


if __name__ == "__main__":
    main()
