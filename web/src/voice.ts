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

export type Intent = "map" | "ban" | "enemy" | "ally" | "unban" | "undo" | "reset";

export interface Command {
  intent: Intent;
  ids: string[];
}

const KEYWORDS: [Intent, RegExp][] = [
  ["reset", /\b(nouvelle (partie|game|draft)|reset|recommence|on recommence)\b/],
  ["undo", /\b(annule|retire|enleve|supprime|oups)\b/],
  ["ban", /\b(bans?|bannis?|banni|bannie|bannissent|interdits?)\b/],
  ["enemy", /\b(en face|adversaires?|ennemis?|ils (prennent|ont pris|choisissent)|eux)\b/],
  ["ally", /\b(nous|on (prend|joue|choisit)|moi|mon pote|allies?|mon ami|je prends)\b/],
  ["map", /\b(map|carte|mode)\b/],
];

/**
 * Découpe une phrase en commandes : « bannis Mortis et Spike, en face Colt »
 * -> [{ban:[mortis, spike]}, {enemy:[colt]}]. Sans mot-clé, une map citée
 * devient la map ; sinon les brawlers suivent l'intention précédente.
 */
export function parseUtterance(text: string, db: Db, fallback: Intent = "enemy"): Command[] {
  const norm = normalize(text);
  // On coupe aux mots-clés pour garder l'ordre des intentions.
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
    if (seg.intent === "reset") {
      out.push({ intent: "reset", ids: [] });
      continue;
    }
    const maps = findEntities(seg.text, db.maps, 0.8);
    const brawlers = findEntities(seg.text, db.brawlers);
    const intent = seg.intent ?? (maps.length && !brawlers.length ? "map" : last);
    if (intent === "map" || (maps.length && !brawlers.length && seg.intent === null)) {
      if (maps.length) out.push({ intent: "map", ids: [maps[0]] });
      continue;
    }
    if (intent === "undo") {
      if (brawlers.length) out.push({ intent: "undo", ids: brawlers });
      continue;
    }
    if (brawlers.length) out.push({ intent, ids: brawlers });
    last = intent;
  }
  return out;
}
