"""Tests du pipeline sur des parties synthétiques (python -m pytest etl ou python etl/test_etl.py)."""
from aggregate import aggregate
from patch_notes import classify
from fetch_battlelogs import battle_record

def _b(winner, a, b, m="safe-zone"):
    return {"map": m, "mapName": "Safe Zone", "mode": "heist", "teams": [a, b], "winner": winner}

def test_aggregate():
    battles = [_b(0, ["colt", "piper", "frank"], ["spike", "mortis", "el-primo"]) for _ in range(60)]
    battles += [_b(1, ["colt", "spike", "frank"], ["piper", "mortis", "el-primo"]) for _ in range(60)]
    r = aggregate(battles, min_pair=10)
    st = r["mapStats"]["safe-zone"]
    assert st["frank"]["winRate"] == 50 and st["frank"]["n"] == 120
    assert st["mortis"]["useRate"] == 100
    # Frank gagne toujours avec Piper, perd toujours avec Spike
    assert r["synergies"]["frank"]["piper"] > 0 > r["synergies"]["frank"]["spike"]

def test_classify():
    assert classify("Main attack damage increased from 1000 to 1100") == "buff"
    assert classify("Dégâts réduits de 1200 à 1100") == "nerf"
    assert classify("Reload time increased from 1.5 to 1.7 seconds") == "nerf"
    assert classify("Super charge rate unchanged") is None

def test_battle_record():
    item = {"battleTime": "20261120T101010.000Z", "event": {"mode": "heist", "map": "Safe Zone"},
            "battle": {"mode": "heist", "type": "soloRanked", "result": "defeat", "teams": [
                [{"tag": "#A", "brawler": {"name": "COLT"}}, {"tag": "#B", "brawler": {"name": "EL PRIMO"}}, {"tag": "#C", "brawler": {"name": "8-BIT"}}],
                [{"tag": "#D", "brawler": {"name": "SPIKE"}}, {"tag": "#E", "brawler": {"name": "MR. P"}}, {"tag": "#F", "brawler": {"name": "R-T"}}]]}}
    r = battle_record(item, "#A")
    assert r["winner"] == 1 and r["map"] == "safe-zone"
    assert r["teams"] == [["colt", "el-primo", "8-bit"], ["spike", "mr-p", "r-t"]]

if __name__ == "__main__":
    test_aggregate(); test_classify(); test_battle_record(); print("ok")
