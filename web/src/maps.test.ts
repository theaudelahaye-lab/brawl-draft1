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
  ])("« %s »", (said, id) => {
    expect(pick(said)).toBe(id);
  });
  it("ne choisit pas au hasard quand c'est ambigu", () => {
    expect(pick("hors jeu")).toBeNull();
  });
});
