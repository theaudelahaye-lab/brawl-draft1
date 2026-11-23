import type { Db } from "./types";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Clé phonétique grossière pour absorber les transcriptions à la française. */
export function phonetic(s: string): string {
  return s
    .replace(/eau|au/g, "o")
    .replace(/eu|oe/g, "e")
    .replace(/ph/g, "f")
    .replace(/qu|ck|c(?=[aou])/g, "k")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  a = phonetic(a);
  b = phonetic(b);
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

interface Candidate {
  id: string;
  key: string;
  words: number;
}

function candidates(items: { id: string; name: string; aliases?: string[] }[]): Candidate[] {
  return items.flatMap((it) =>
    [it.name, ...(it.aliases ?? [])].map((n) => {
      const key = normalize(n);
      return { id: it.id, key, words: key.split(" ").length };
    }),
  );
}

/** Trouve toutes les entités citées dans une phrase, dans l'ordre. */
export function findEntities(
  text: string,
  items: { id: string; name: string; aliases?: string[] }[],
  threshold = 0.78,
): string[] {
  const words = normalize(text).split(" ").filter(Boolean);
  const cands = candidates(items);
  const maxW = Math.max(1, ...cands.map((c) => c.words));
  const found: string[] = [];
  let i = 0;
  while (i < words.length) {
    let best: { id: string; score: number; len: number } | null = null;
    for (let len = Math.min(maxW, words.length - i); len >= 1; len--) {
      const chunk = words.slice(i, i + len).join(" ");
      for (const c of cands) {
        if (Math.abs(c.words - len) > 1) continue;
        const sc = similarity(chunk, c.key);
        if (sc >= threshold && (!best || sc > best.score || (sc === best.score && len > best.len))) {
          best = { id: c.id, score: sc, len };
        }
      }
    }
    if (best) {
      if (!found.includes(best.id)) found.push(best.id);
      i += best.len;
    } else i++;
  }
  return found;
}

export type Intent = "ban" | "enemy" | "ally" | "undo" | "reset" | "changeMap";

export interface Command {
  intent: Intent;
  ids: string[];
}

const KEYWORDS: [Intent, RegExp][] = [
  ["changeMap", /\b(change(r|z)? (de )?(map|carte)|autre (map|carte)|mauvaise (map|carte))\b/],
  ["reset", /\b(nouvelle (partie|game|draft)|reset|recommence|on recommence)\b/],
  ["undo", /\b(annule|retire|enleve|supprime|oups)\b/],
  ["ban", /\b(bans?|bannis?|banni|bannie|bannissent|interdits?)\b/],
  ["enemy", /\b(en face|adversaires?|ennemis?|ils (prennent|ont pris|choisissent)|eux)\b/],
  ["ally", /\b(nous|on (prend|joue|choisit)|moi|mon pote|allies?|mon ami|je prends)\b/],
];

/**
 * Phase brawlers uniquement : « bannis Mortis et Spike, en face Colt »
 * -> [{ban:[mortis, spike]}, {enemy:[colt]}]. Sans mot-clé, les brawlers
 * vont dans la colonne active. Les maps ne sont jamais cherchées ici.
 */
export function parseUtterance(text: string, db: Db, fallback: Intent = "enemy"): Command[] {
  const norm = normalize(text);
  const marks: { pos: number; intent: Intent }[] = [];
  for (const [intent, re] of KEYWORDS) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(norm))) marks.push({ pos: m.index, intent });
  }
  marks.sort((a, b) => a.pos - b.pos);

  const segments: { intent: Intent | null; text: string }[] = [];
  if (!marks.length || marks[0].pos > 0) segments.push({ intent: null, text: norm.slice(0, marks[0]?.pos ?? norm.length) });
  marks.forEach((mk, k) => segments.push({ intent: mk.intent, text: norm.slice(mk.pos, marks[k + 1]?.pos ?? norm.length) }));

  const out: Command[] = [];
  let last: Intent = fallback;
  for (const seg of segments) {
    if (seg.intent === "reset" || seg.intent === "changeMap") {
      out.push({ intent: seg.intent, ids: [] });
      continue;
    }
    const brawlers = findEntities(seg.text, db.brawlers);
    const intent = seg.intent ?? last;
    if (brawlers.length) out.push({ intent, ids: brawlers });
    last = intent;
  }
  return out;
}

// ---------------------------------------------------------------- maps

/** Façons de dire chaque mode du classé (après normalize). */
export const MODE_WORDS: Record<string, string[]> = {
  "Razzia de gemmes": ["razzia de gemmes", "razzia", "gemmes", "gemme", "gem grab", "gems"],
  Brawlball: ["brawlball", "brawl ball", "foot", "football", "ballon"],
  Braquage: ["braquage", "heist", "coffre"],
  Prime: ["prime", "bounty", "etoiles"],
  "Zone réservée": ["zone reservee", "hot zone", "zones"],
  "Hors-jeu": ["hors jeu", "hors jeux", "or jeu", "knockout", "knock out", "ko"],
};
export const RANKED_MODES = Object.keys(MODE_WORDS);

const STOP = new Set([
  "la", "le", "les", "l", "de", "des", "du", "d", "un", "une", "sur", "en", "et", "a", "au", "aux",
  "map", "carte", "mode", "c", "est", "on", "est", "tombe", "joue", "the", "of", "s", "in", "to", "it",
  "alors", "euh", "bon", "donc", "ok", "c'est",
]);

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/** Repère un mode cité dans la phrase et renvoie la phrase sans lui. */
export function detectMode(text: string): { mode: string | null; rest: string } {
  const norm = ` ${normalize(text)} `;
  let best: { mode: string; word: string } | null = null;
  for (const [mode, words] of Object.entries(MODE_WORDS))
    for (const w of words)
      if (norm.includes(` ${w} `) && (!best || w.length > best.word.length)) best = { mode, word: w };
  if (!best) return { mode: null, rest: text };
  return { mode: best.mode, rest: norm.replace(` ${best.word} `, " ").trim() };
}

export interface MapMatch {
  id: string;
  score: number;
}

/**
 * Classe les maps par ressemblance avec ce qui a été dit ou écrit.
 * Tolérant : mots dans le désordre, mots en trop, traduction partielle
 * (« rocher de la Belle » retrouve « Belle's Rock » grâce à « belle »).
 */
export function matchMaps(text: string, db: Db, learned: Record<string, string> = {}): MapMatch[] {
  const norm = normalize(text);
  if (learned[norm]) return [{ id: learned[norm], score: 2 }];
  const { mode, rest } = detectMode(text);
  const q = tokens(rest);
  const ranked = new Set(Object.keys(db.mapStats));
  const pool = db.maps.filter((m) => (mode ? m.mode === mode : RANKED_MODES.includes(m.mode)));
  const out: MapMatch[] = [];
  for (const m of pool) {
    let best = 0;
    for (const label of [m.name, ...(m.aliases ?? [])]) {
      const c = tokens(label);
      if (!c.length) continue;
      if (!q.length) continue;
      let hit = 0;
      for (const t of q) {
        let s = 0;
        for (const u of c) s = Math.max(s, similarity(t, u));
        if (s >= 0.72) hit += s;
      }
      const precision = hit / q.length;
      const recall = Math.min(hit, c.length) / c.length;
      const f = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      const whole = similarity(q.join(" "), c.join(" "));
      best = Math.max(best, f, whole);
    }
    if (!q.length && mode) best = 0.3; // seul le mode a été dit : on propose ses maps
    if (best <= 0) continue;
    out.push({ id: m.id, score: best + (ranked.has(m.id) ? 0.15 : 0) + (mode ? 0.05 : 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Choix automatique seulement si la meilleure map se détache nettement. */
export function confidentMap(matches: MapMatch[]): string | null {
  if (!matches.length) return null;
  const [a, b] = matches;
  if (a.score >= 2) return a.id;
  if (a.score >= 0.55 && (!b || a.score - b.score >= 0.12)) return a.id;
  return null;
}
