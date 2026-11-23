// Format de la base générée par le pipeline (etl/build.py -> public/data/db.json)

export interface Brawler {
  id: string; // slug stable, ex. "el-primo"
  name: string;
  aliases?: string[]; // variantes de prononciation pour la voix
  className?: string;
}

export interface GameMap {
  id: string;
  name: string;
  mode: string; // ex. "Brawl Ball"
  aliases?: string[];
}

export interface Stat {
  winRate: number; // 0-100
  useRate?: number; // 0-100
  n?: number; // nombre de parties observées
}

export interface Change {
  brawlerId: string;
  type: "buff" | "nerf" | "rework";
  note?: string;
}

export interface Patch {
  date: string; // ISO
  version?: string;
  changes: Change[];
}

export interface Db {
  generatedAt: string;
  sources: string[];
  brawlers: Brawler[];
  maps: GameMap[];
  /** mapId -> brawlerId -> stat */
  mapStats: Record<string, Record<string, Stat>>;
  /** brawlerId -> adversaireId -> écart de winrate (points) quand A affronte B */
  matchups: Record<string, Record<string, number>>;
  /** brawlerId -> alliéId -> écart de winrate (points) quand A joue avec B */
  synergies: Record<string, Record<string, number>>;
  patches: Patch[];
  activeMaps?: string[];
}

export interface DraftState {
  mapId: string | null;
  weHaveFirstPick: boolean;
  bans: string[];
  allies: string[];
  enemies: string[];
}
