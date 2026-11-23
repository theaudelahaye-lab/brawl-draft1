import { describe, expect, it } from "vitest";
import { currentPhase, picksThisTurn, recommendBans, recommendPicks } from "./engine";
import { parseUtterance } from "./voice";
import type { Db, DraftState } from "./types";

// Jeu de données de test uniquement (valeurs inventées), pas une vraie base.
const db: Db = {
  generatedAt: "2026-11-01T00:00:00Z",
  sources: ["test"],
  brawlers: [
    { id: "colt", name: "Colt" },
    { id: "el-primo", name: "El Primo", aliases: ["primo"] },
    { id: "spike", name: "Spike" },
    { id: "mortis", name: "Mortis" },
    { id: "piper", name: "Piper" },
    { id: "frank", name: "Frank" },
  ],
  maps: [
    { id: "hard-rock-mine", name: "Hard Rock Mine", mode: "Gem Grab" },
    { id: "safe-zone", name: "Safe Zone", mode: "Heist" },
  ],
  mapStats: {
    "safe-zone": {
      colt: { winRate: 58, useRate: 12, n: 2000 },
      piper: { winRate: 52, useRate: 6, n: 1000 },
      spike: { winRate: 55, useRate: 4, n: 800 },
      "el-primo": { winRate: 47, useRate: 3, n: 600 },
      mortis: { winRate: 44, useRate: 2, n: 50 },
      frank: { winRate: 49, useRate: 1, n: 300 },
    },
  },
  matchups: { piper: { colt: 4 }, "el-primo": { piper: 8 } },
  synergies: { frank: { colt: 3 } },
  patches: [{ date: "2026-11-20", version: "test", changes: [{ brawlerId: "frank", type: "buff" }] }],
};

const base: DraftState = { mapId: "safe-zone", weHaveFirstPick: true, bans: [], allies: [], enemies: [] };
const now = new Date("2026-11-23");

describe("phases", () => {
  it("suit l'ordre 1-2-2-1", () => {
    expect(currentPhase({ ...base, mapId: null })).toBe("map");
    expect(currentPhase(base)).toBe("ban");
    const s1 = { ...base, bans: ["a", "b", "c", "d", "e", "f"] };
    expect(currentPhase(s1)).toBe("ourPick");
    expect(picksThisTurn(s1)).toBe(1);
    const s2 = { ...s1, allies: ["x"] };
    expect(currentPhase(s2)).toBe("theirPick");
    expect(picksThisTurn(s2)).toBe(2);
    expect(currentPhase({ ...s2, enemies: ["y", "z"] })).toBe("ourPick");
  });
});

describe("recommandations", () => {
  it("met en avant la force sur la map", () => {
    expect(recommendPicks(db, base, undefined, now)[0].brawlerId).toBe("colt");
  });
  it("exclut bans et picks, et applique contres + synergie + patch", () => {
    const s = { ...base, bans: ["colt"], enemies: ["piper"] };
    const r = recommendPicks(db, s, undefined, now);
    expect(r.map((x) => x.brawlerId)).not.toContain("colt");
    expect(r[0].brawlerId).toBe("el-primo"); // contre Piper
  });
  it("respecte la collection du joueur", () => {
    const r = recommendPicks(db, base, new Set(["spike", "frank"]), now);
    expect(r.map((x) => x.brawlerId).sort()).toEqual(["frank", "spike"]);
  });
  it("propose de bannir le brawler le plus dangereux", () => {
    expect(recommendBans(db, base, now)[0].brawlerId).toBe("colt");
  });
});

describe("voix", () => {
  it("comprend une phrase de draft", () => {
    const cmds = parseUtterance("bannis mortis et spike, en face colt", db);
    expect(cmds).toEqual([
      { intent: "ban", ids: ["mortis", "spike"] },
      { intent: "enemy", ids: ["colt"] },
    ]);
  });
  it("tolère les approximations", () => {
    expect(parseUtterance("on prend él primau", db)).toEqual([{ intent: "ally", ids: ["el-primo"] }]);
    expect(parseUtterance("ils ont pris pipeur", db)).toEqual([{ intent: "enemy", ids: ["piper"] }]);
  });
  it("ne cherche jamais de map pendant la draft", () => {
    expect(parseUtterance("safe zone", db)).toEqual([]);
    expect(parseUtterance("changer de map", db)).toEqual([{ intent: "changeMap", ids: [] }]);
  });
});
