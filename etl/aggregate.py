"""Transforme les parties brutes en winrates par map, contres et synergies."""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations


def aggregate(battles: list[dict], min_pair: int = 40) -> dict:
    map_wins = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # map -> brawler -> [wins, games]
    map_games = defaultdict(int)
    solo = defaultdict(lambda: [0, 0])
    vs = defaultdict(lambda: [0, 0])  # (a, b) -> a gagne contre b
    with_ = defaultdict(lambda: [0, 0])  # (a, b) -> a gagne avec b
    maps_meta: dict[str, dict] = {}

    for b in battles:
        maps_meta[b["map"]] = {"id": b["map"], "name": b.get("mapName", b["map"]), "mode": b.get("mode") or ""}
        map_games[b["map"]] += 1
        for side, team in enumerate(b["teams"]):
            won = int(side == b["winner"])
            other = b["teams"][1 - side]
            for br in team:
                cell = map_wins[b["map"]][br]
                cell[0] += won
                cell[1] += 1
                solo[br][0] += won
                solo[br][1] += 1
                for o in other:
                    vs[(br, o)][0] += won
                    vs[(br, o)][1] += 1
            for x, y in combinations(team, 2):
                for a, c in ((x, y), (y, x)):
                    with_[(a, c)][0] += won
                    with_[(a, c)][1] += 1

    def wr(c):
        return 100 * c[0] / c[1]

    map_stats = {
        m: {
            br: {"winRate": round(wr(c), 2), "useRate": round(100 * c[1] / map_games[m], 2), "n": c[1]}
            for br, c in per.items()
        }
        for m, per in map_wins.items()
    }

    def deltas(table):
        out = defaultdict(dict)
        for (a, o), c in table.items():
            if c[1] < min_pair or solo[a][1] == 0:
                continue
            # Écart lissé : on réduit l'écart quand l'échantillon est petit.
            shrink = c[1] / (c[1] + min_pair)
            out[a][o] = round((wr(c) - wr(solo[a])) * shrink, 2)
        return dict(out)

    return {
        "maps": list(maps_meta.values()),
        "mapStats": map_stats,
        "matchups": deltas(vs),
        "synergies": deltas(with_),
        "games": len(battles),
    }
