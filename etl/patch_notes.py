"""Ajoute les buffs et nerfs d'un patch à data/patches.json.

Usage :
  python etl/patch_notes.py --version "Saison 42" --date 2026-11-20 notes.txt
  (ou le texte sur l'entrée standard)

Le script repère les lignes qui citent un brawler et devine buff / nerf à partir
du vocabulaire (augmenté, réduit, increased, decreased…). Relisez le résultat :
il affiche ce qu'il a trouvé et vous pouvez corriger data/patches.json à la main.
Les entrées des 14 derniers jours ajustent les scores tant que les stats n'ont pas
encore absorbé le patch.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date

from common import RAW, ROOT, read_json, write_json

UP = re.compile(r"\b(increas|augment|buff|boost|faster|plus rapide|more|plus de|hausse|from \d+ to \d+)", re.I)
DOWN = re.compile(r"\b(decreas|redui|réduit|diminu|nerf|lower|slower|less|moins|baisse)", re.I)
REWORK = re.compile(r"\b(rework|refonte|retravaill)", re.I)
# Une stat négative qui baisse est un buff (temps de recharge, délai…).
INVERTED = re.compile(r"\b(reload|recharge|cooldown|delay|délai|charge time|wind ?up)", re.I)


def classify(line: str) -> str | None:
    if REWORK.search(line):
        return "rework"
    up, down = bool(UP.search(line)), bool(DOWN.search(line))
    m = re.search(r"from ([\d.]+)\D+to ([\d.]+)|de ([\d.]+)\D+à ([\d.]+)", line, re.I)
    if m:
        a, b = [float(x) for x in m.groups() if x is not None]
        up, down = b > a, b < a
    if up == down:
        return None
    kind = "buff" if up else "nerf"
    if INVERTED.search(line):
        kind = "nerf" if kind == "buff" else "buff"
    return kind


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--version", default=None)
    ap.add_argument("--date", default=date.today().isoformat())
    args = ap.parse_args()
    text = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()

    brawlers = (read_json(RAW / "brawlify.json", {}) or {}).get("brawlers", [])
    names = sorted(((b["name"], b["id"]) for b in brawlers), key=lambda x: -len(x[0]))
    if not names:
        sys.exit("Lancez d'abord fetch_brawlify.py pour connaître la liste des brawlers.")

    votes: dict[str, dict[str, int]] = {}
    current: str | None = None
    for line in text.splitlines():
        hit = next((bid for n, bid in names if re.search(rf"\b{re.escape(n)}\b", line, re.I)), None)
        if hit:
            current = hit
        if not current:
            continue
        kind = classify(line)
        if kind:
            votes.setdefault(current, {}).setdefault(kind, 0)
            votes[current][kind] += 1

    changes = []
    for bid, v in votes.items():
        kind = "rework" if "rework" in v else max(v, key=v.get)
        changes.append({"brawlerId": bid, "type": kind})
        print(f"  {bid:16s} {kind:7s} {v}")

    path = ROOT / "data" / "patches.json"
    patches = read_json(path, [])
    patches = [p for p in patches if not (p["date"] == args.date and p.get("version") == args.version)]
    patches.append({"date": args.date, "version": args.version, "changes": changes})
    patches.sort(key=lambda p: p["date"])
    write_json(path, patches)
    print(f"{len(changes)} changements enregistrés dans {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
