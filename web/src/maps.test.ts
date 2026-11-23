import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { confidentMap, matchMaps } from "./voice";
import type { Db } from "./types";

// Tests sur la vraie base publiée (ignorés si elle n'est pas encore générée).
const path = new URL("../public/data/db.json", import.meta.url);
const db: Db | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
const pick = (t: string) => (db ? confidentMap(matchMaps(t, db)) : null);

describe.skipIf(!db)("reconnaissance des maps (base réelle)", () => {
  it.each([
    ["Hors-jeu, rocher de la Belle", "belle-s-rock"],
    ["map hors jeu rocher de la belle", "belle-s-rock"],
    ["belle's rock", "belle-s-rock"],
    ["zone sécurisée", "safe-zone"],
    ["braquage safe zone", "safe-zone"],
    ["c'est chaud patate", "hot-potato"],
    ["razzia de gemmes hard rock mine", "hard-rock-mine"],
    ["hard rock", "hard-rock-mine"],
    ["prime layer cake", "layer-cake"],
    ["kaboom canyon", "kaboom-canyon"],
    ["phénix flamboyant", "flaring-phoenix"],
    ["la map c'est fort de gemmes", "fort-de-gemmes".replace("fort-de-gemmes", "gem-fort")],
    ["stratégie parallèle", "parallel-plays"],
    ["undermine", "undermine"],
    ["champ sournois", "sneaky-fields"],
    ["mine hard rock", "hard-rock-mine"], ["tunnel de mine", "undermine"], ["flipper", "pinball-dreams"],
    ["prime cachette secrète", "hideout"], ["canyon boum boum", "kaboom-canyon"], ["mille feuilles", "layer-cake"],
    ["cercle de feu", "ring-of-fire"], ["ravin du bras d'or", "goldarm-gulch"], ["à découvert", "out-in-the-open"],
    ["étoile filante", "shooting-star"], ["nouveaux horizons", "new-horizons"], ["duel de scarabées", "dueling-beetles"],
    ["pont au loin", "bridge-too-far"], ["saison sèche", "dry-season"], ["bruissement", "double-swoosh"],
  ])("« %s »", (said, id) => {
    expect(pick(said)).toBe(id);
  });
  it("ne choisit pas au hasard quand c'est ambigu", () => {
    expect(pick("hors jeu")).toBeNull();
  });
});

describe.skipIf(!db)("reconnaissance des brawlers (base réelle)", () => {
  it.each([
    ["chelly", "shelly"], ["spaïk", "spike"], ["el costo", "el-primo"], ["corbac", "crow"],
    ["mortisse", "mortis"], ["léon", "leon"], ["ricochet", "rico"], ["arcade", "8-bit"],
    ["dijinn", "gene"], ["polly", "piper"], ["émeri", "sandy"], ["tic", "tick"], ["eliza", "emz"],
    ["monsieur m", "mr-p"], ["bartaba", "barley"], ["médor", "ruffs"], ["kit", "kit"], ["frank", "frank"],
    ["ambre", "amber"], ["mélodie", "melodie"], ["surge", "surge"], ["edgar", "edgar"], ["gaël", "gale"],
  ])("« %s »", async (said, id) => {
    const { parseUtterance } = await import("./voice");
    expect(parseUtterance(said, db!, "enemy")).toEqual([{ intent: "enemy", ids: [id] }]);
  });
  it("le filtre par lettre trie par ordre alphabétique", async () => {
    const { filterByPrefix } = await import("./voice");
    const t = filterByPrefix(db!.brawlers, "t").map((b) => b.name);
    const starting = t.filter((n) => n.toLowerCase().startsWith("t"));
    expect(t.slice(0, starting.length)).toEqual(starting);
    expect(starting).toEqual([...starting].sort((a, b) => a.localeCompare(b, "fr")));
    expect(starting).toContain("Tick");
  });
});
