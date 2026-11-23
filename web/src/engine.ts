import type { Db, DraftState } from "./types";

/** Ordre des picks en classé : A, B B, A A, B (A = première équipe à choisir). */
const PICK_ORDER: ("first" | "second")[] = ["first", "second", "second", "first", "first", "second"];

export type Phase = "map" | "ban" | "ourPick" | "theirPick" | "done";

export function currentPhase(s: DraftState): Phase {
  if (!s.mapId) return "map";
  const picked = s.allies.length + s.enemies.length;
  if (picked === 0 && s.bans.length < 6) return "ban";
  if (picked >= 6) return "done";
  const turn = PICK_ORDER[picked];
  const ours = (turn === "first") === s.weHaveFirstPick;
  return ours ? "ourPick" : "theirPick";
}

/** Nombre de picks que nous devons faire maintenant (1 ou 2). */
export function picksThisTurn(s: DraftState): number {
  const picked = s.allies.length + s.enemies.length;
  if (picked >= 6) return 0;
  const turn = PICK_ORDER[picked];
  return PICK_ORDER[picked + 1] === turn ? 2 : 1;
}

export interface Reason {
  label: string;
  value: number;
}

export interface Reco {
  brawlerId: string;
  score: number;
  reasons: Reason[];
}

const PRIOR_GAMES = 150; // lissage bayésien vers 50 % pour les petits échantillons
const PATCH_WEIGHT = { buff: 2, nerf: -2, rework: 0 } as const;
const PATCH_FRESH_DAYS = 14;

export function mapStrength(db: Db, mapId: string, id: string): number {
  const st = db.mapStats[mapId]?.[id];
  if (!st) return 0;
  const n = st.n ?? PRIOR_GAMES;
  const smoothed = (st.winRate * n + 50 * PRIOR_GAMES) / (n + PRIOR_GAMES);
  return smoothed - 50;
}

/** Ajustement dû aux patchs publiés après la génération des stats (ou très récents). */
export function patchAdjust(db: Db, id: string, now = new Date()): { value: number; note?: string } {
  const statsDate = new Date(db.generatedAt).getTime();
  let value = 0;
  let note: string | undefined;
  for (const p of db.patches) {
    const t = new Date(p.date).getTime();
    const ageDays = (now.getTime() - t) / 86_400_000;
    // Si les stats ont été calculées bien après le patch, elles l'intègrent déjà.
    const statsCoverIt = (statsDate - t) / 86_400_000 > 3;
    if (statsCoverIt || ageDays > PATCH_FRESH_DAYS) continue;
    for (const c of p.changes) {
      if (c.brawlerId !== id) continue;
      value += PATCH_WEIGHT[c.type];
      note = `${c.type}${p.version ? ` (${p.version})` : ""}${c.note ? ` : ${c.note}` : ""}`;
    }
  }
  return { value, note };
}

function sumRel(table: Db["matchups"], id: string, others: string[]): number {
  let s = 0;
  for (const o of others) s += table[id]?.[o] ?? 0;
  return s;
}

export function available(db: Db, s: DraftState, owned?: Set<string>): string[] {
  const taken = new Set([...s.bans, ...s.allies, ...s.enemies]);
  return db.brawlers
    .map((b) => b.id)
    .filter((id) => !taken.has(id) && (!owned || owned.size === 0 || owned.has(id)));
}

/** Meilleurs picks pour nous. */
export function recommendPicks(db: Db, s: DraftState, owned?: Set<string>, now = new Date()): Reco[] {
  if (!s.mapId) return [];
  const mapId = s.mapId;
  return available(db, s, owned)
    .map((id) => {
      const reasons: Reason[] = [];
      const m = mapStrength(db, mapId, id);
      reasons.push({ label: "Force sur la map", value: m });
      const counter = sumRel(db.matchups, id, s.enemies);
      if (s.enemies.length) reasons.push({ label: "Face aux adversaires", value: counter });
      const syn = sumRel(db.synergies, id, s.allies);
      if (s.allies.length) reasons.push({ label: "Synergie avec l'équipe", value: syn });
      const p = patchAdjust(db, id, now);
      if (p.value) reasons.push({ label: `Patch ${p.note ?? ""}`.trim(), value: p.value });
      const score = m + counter + syn + p.value;
      return { brawlerId: id, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Picks probables de l'adversaire (vu de leur côté) : utile pour anticiper
 * et pour choisir les bans.
 */
export function enemyThreats(db: Db, s: DraftState, now = new Date()): Reco[] {
  const mirrored: DraftState = { ...s, allies: s.enemies, enemies: s.allies };
  return recommendPicks(db, mirrored, undefined, now);
}

/** Bans : brawlers forts sur la map, pondérés par leur popularité. */
export function recommendBans(db: Db, s: DraftState, now = new Date()): Reco[] {
  if (!s.mapId) return [];
  const mapId = s.mapId;
  return enemyThreats(db, s, now)
    .map((r) => {
      const use = db.mapStats[mapId]?.[r.brawlerId]?.useRate ?? 0;
      const pop = Math.min(use, 20) * 0.15;
      return {
        ...r,
        score: r.score + pop,
        reasons: pop ? [...r.reasons, { label: "Très joué sur cette map", value: pop }] : r.reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}
