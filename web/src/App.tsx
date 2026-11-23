import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Db, DraftState } from "./types";
import { currentPhase, enemyThreats, picksThisTurn, recommendBans, recommendPicks, type Reco } from "./engine";
import { confidentMap, filterByPrefix, matchMaps, normalize, parseUtterance, RANKED_MODES, type Command, type MapMatch } from "./voice";
import { useSpeech } from "./useSpeech";
import "./App.css";

const EMPTY: DraftState = { mapId: null, weHaveFirstPick: true, bans: [], allies: [], enemies: [] };
type Slot = "ban" | "ally" | "enemy";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage indisponible */
  }
}

function applyCommand(s: DraftState, c: Command): DraftState {
  const without = (ids: string[]) => ({
    ...s,
    bans: s.bans.filter((x) => !ids.includes(x)),
    allies: s.allies.filter((x) => !ids.includes(x)),
    enemies: s.enemies.filter((x) => !ids.includes(x)),
  });
  switch (c.intent) {
    case "reset":
      return { ...EMPTY, weHaveFirstPick: s.weHaveFirstPick };
    case "changeMap":
      return { ...s, mapId: null };
    case "undo":
      return without(c.ids);
    case "ban": {
      const n = without(c.ids);
      return { ...n, bans: [...n.bans, ...c.ids].slice(0, 6) };
    }
    case "ally": {
      const n = without(c.ids);
      return { ...n, allies: [...n.allies, ...c.ids].slice(0, 3) };
    }
    case "enemy": {
      const n = without(c.ids);
      return { ...n, enemies: [...n.enemies, ...c.ids].slice(0, 3) };
    }
  }
}

function initials(name: string) {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Couleur et libellé par rôle (illustrations originales, aucun visuel du jeu). */
const ROLES: Record<string, [number, string]> = {
  "Damage Dealer": [0, "Dégâts"],
  Tank: [28, "Tank"],
  Assassin: [280, "Assassin"],
  Support: [140, "Soutien"],
  Controller: [190, "Contrôle"],
  Marksman: [52, "Tireur"],
  Artillery: [320, "Artillerie"],
};
let ROLE_OF: Record<string, string | undefined> = {};
const roleHue = (id: string) => ROLES[ROLE_OF[id] ?? ""]?.[0] ?? hue(id);

function Tile({
  id, name, onClick, disabled, badge, sub,
}: { id: string; name: string; onClick: () => void; disabled?: boolean; badge?: string; sub?: string }) {
  return (
    <button className="tile" disabled={disabled} onClick={onClick} title={sub} style={{ ["--h" as string]: roleHue(id) }}>
      <span className="tileArt">{initials(name)}</span>
      <span className="tileName">{name}</span>
      {badge && <span className="tileBadge">{badge}</span>}
      {sub && <span className="tileSub">{sub}</span>}
    </button>
  );
}

function Chip({ id, name, onRemove }: { id: string; name: string; onRemove?: () => void }) {
  return (
    <span className="chip" style={{ ["--h" as string]: roleHue(id) }}>
      <span className="avatar">{initials(name)}</span>
      {name}
      {onRemove && (
        <button className="x" onClick={onRemove} aria-label={`Retirer ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export default function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<DraftState>(() => load("draft", EMPTY));
  const [owned, setOwned] = useState<string[]>(() => load("owned", []));
  const [slot, setSlot] = useState<Slot>("enemy");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Taper une lettre n'importe où envoie directement dans le champ de saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") setQuery("");
      else if (/^[\p{L}0-9]$/u.test(e.key)) inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [lastHeard, setLastHeard] = useState("");
  const [showOwned, setShowOwned] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/db.json`, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setDb)
      .catch((e) => setLoadError(String(e)));
  }, []);
  useEffect(() => save("draft", state), [state]);
  useEffect(() => save("owned", owned), [owned]);

  const phase = currentPhase(state);
  useEffect(() => {
    if (phase === "ban") setSlot("ban");
    else if (phase === "ourPick") setSlot("ally");
    else if (phase === "theirPick") setSlot("enemy");
  }, [phase]);

  const name = useCallback((id: string) => db?.brawlers.find((b) => b.id === id)?.name ?? id, [db]);
  const ownedSet = useMemo(() => new Set(owned), [owned]);

  const [learned, setLearned] = useState<Record<string, string>>(() => load("mapAliases", {}));
  useEffect(() => save("mapAliases", learned), [learned]);
  const [suggestions, setSuggestions] = useState<MapMatch[]>([]);
  const [pendingQuery, setPendingQuery] = useState("");
  const [notice, setNotice] = useState("");

  const chooseMap = useCallback((id: string, fromQuery?: string) => {
    setState((s) => ({ ...s, mapId: id }));
    // Si la map a été choisie après une phrase mal comprise, on retient la phrase.
    if (fromQuery && normalize(fromQuery)) setLearned((l) => ({ ...l, [normalize(fromQuery)]: id }));
    setSuggestions([]);
    setPendingQuery("");
    setQuery("");
    setNotice("");
  }, []);

  /** Une phrase dite ou écrite. Étape map : on ne cherche QUE des maps. Ensuite : QUE des brawlers. */
  const handleInput = useCallback(
    (alternatives: string[]) => {
      if (!db) return;
      const alts = alternatives.map((a) => a.trim()).filter(Boolean);
      if (!alts.length) return;
      setLastHeard(alts[0]);
      if (!state.mapId) {
        let best: { text: string; matches: MapMatch[] } | null = null;
        for (const t of alts) {
          const m = matchMaps(t, db, learned);
          if (m.length && (!best || m[0].score > best.matches[0].score)) best = { text: t, matches: m };
        }
        if (!best) {
          setNotice(`Je n'ai reconnu aucune map dans « ${alts[0]} ». Réessayez ou touchez la bonne map.`);
          setSuggestions([]);
          return;
        }
        const sure = confidentMap(best.matches);
        if (sure) chooseMap(sure);
        else {
          setSuggestions(best.matches.slice(0, 6));
          setPendingQuery(best.text);
          setNotice("Laquelle est-ce ? Touchez la bonne map, je m'en souviendrai.");
        }
        return;
      }
      const fallback = slot === "ban" ? "ban" : slot === "ally" ? "ally" : "enemy";
      for (const t of alts) {
        const cmds = parseUtterance(t, db, fallback);
        if (cmds.length) {
          setState((s) => cmds.reduce(applyCommand, s));
          setNotice("");
          return;
        }
      }
      setNotice(`Aucun brawler reconnu dans « ${alts[0]} ».`);
    },
    [db, slot, state.mapId, learned, chooseMap],
  );
  const speech = useSpeech(handleInput);

  const picks = useMemo(() => (db ? recommendPicks(db, state, ownedSet) : []), [db, state, ownedSet]);
  const bans = useMemo(() => (db ? recommendBans(db, state) : []), [db, state]);
  const threats = useMemo(() => (db ? enemyThreats(db, state) : []), [db, state]);

  if (loadError)
    return (
      <main className="app">
        <h1>Draft Coach</h1>
        <p className="warn">
          La base de données n'est pas encore générée ({loadError}). Lancez le pipeline <code>etl/build.py</code>{" "}
          ou attendez la prochaine mise à jour automatique.
        </p>
      </main>
    );
  if (!db) return <main className="app">Chargement…</main>;

  const map = db.maps.find((m) => m.id === state.mapId);
  const q = normalize(query);
  const mapById = (id: string) => db.maps.find((m) => m.id === id);
  const typedMaps = q && !state.mapId ? matchMaps(query, db, learned).slice(0, 6) : [];
  const shownSuggestions = typedMaps.length ? typedMaps : suggestions;
  const rankedByMode = RANKED_MODES.map((mode) => ({
    mode,
    maps: db.maps
      .filter((m) => m.mode === mode && db.mapStats[m.id])
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  })).filter((g) => g.maps.length);
  ROLE_OF = Object.fromEntries(db.brawlers.map((b) => [b.id, b.className]));
  const brawlerResults = filterByPrefix(db.brawlers, query);
  const taken = new Set([...state.bans, ...state.allies, ...state.enemies]);

  const add = (id: string) => setState((s) => applyCommand(s, { intent: slot, ids: [id] }));
  const remove = (id: string) => setState((s) => applyCommand(s, { intent: "undo", ids: [id] }));

  const phaseText: Record<typeof phase, string> = {
    map: "Indiquez la map",
    ban: `Phase de bans (${state.bans.length}/6)`,
    ourPick: `À nous : ${picksThisTurn(state)} pick${picksThisTurn(state) > 1 ? "s" : ""}`,
    theirPick: `À eux : ${picksThisTurn(state)} pick${picksThisTurn(state) > 1 ? "s" : ""}`,
    done: "Draft terminée, bonne chance",
  };

  const mainList: { title: string; items: Reco[] } =
    phase === "ban"
      ? { title: "Bans conseillés", items: bans }
      : phase === "theirPick"
        ? { title: "Ce qu'ils risquent de prendre", items: threats }
        : { title: "Picks conseillés", items: picks };

  return (
    <main className="app">
      <header>
        <h1>Draft <span>Coach</span></h1>
        <div className="row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={state.weHaveFirstPick}
              onChange={(e) => setState((s) => ({ ...s, weHaveFirstPick: e.target.checked }))}
            />
            Premier pick
          </label>
          <button onClick={() => setShowOwned((v) => !v)}>Ma collection ({owned.length || "toutes"})</button>
          <button className="btn-yellow" onClick={() => setState((s) => applyCommand(s, { intent: "reset", ids: [] }))}>Nouvelle draft</button>
        </div>
      </header>

      {Object.keys(db.mapStats).length === 0 && (
        <p className="warn">
          Statistiques pas encore disponibles : les conseils ne sont pas encore fiables. Ajoutez la clé de l'API
          officielle (voir DEPLOIEMENT.md, étape 5).
        </p>
      )}

      <section className="voice">
        {speech.supported ? (
          <button className={`mic ${speech.listening ? "on" : ""}`} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.listening ? "● J'écoute" : "🎤 Activer la voix"}
          </button>
        ) : (
          <p className="warn">Reconnaissance vocale non disponible : utilisez Chrome ou Edge.</p>
        )}
        <p className="heard">
          {speech.interim ||
            lastHeard ||
            (state.mapId ? "Ex. : « bannis Mortis et Spike », « en face Colt », « on prend Polly »" : "Ex. : « Hors-jeu, rocher de la Belle »")}
        </p>
        {speech.error && <p className="warn">Micro : {speech.error}</p>}
      </section>

      {notice && <p className="notice">{notice}</p>}

      {!state.mapId ? (
        <section className="mapstep">
          <h2>Étape 1 · La map</h2>
          <input
            ref={inputRef}
            className="bigInput"
            autoFocus
            placeholder="Tapez quelques lettres de la map… Entrée = 1re proposition"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") return setQuery("");
              if (e.key !== "Enter" || !query.trim()) return;
              if (typedMaps[0]) chooseMap(typedMaps[0].id);
              else handleInput([query]);
            }}
          />
          {shownSuggestions.length > 0 && (
            <div className="grid suggest">
              {shownSuggestions.map((m) => {
                const mm = mapById(m.id);
                return mm ? (
                  <button key={m.id} className="btn-yellow" onClick={() => chooseMap(m.id, typedMaps.length ? undefined : pendingQuery)}>
                    {mm.name} <small>{mm.mode}</small>
                  </button>
                ) : null;
              })}
            </div>
          )}
          {rankedByMode.map((g) => (
            <div key={g.mode} className="modegroup">
              <h3>{g.mode}</h3>
              <div className="grid">
                {g.maps.map((m) => (
                  <button key={m.id} onClick={() => chooseMap(m.id, pendingQuery || undefined)}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <>
          <section className="status">
            <div>
              <strong>
                {map ? `${map.name} · ${map.mode}` : "Map inconnue"}{" "}
                <button className="small" onClick={() => setState((s) => ({ ...s, mapId: null }))}>
                  Changer de map
                </button>
              </strong>
              <span className="phase">{phaseText[phase]}</span>
            </div>
            <div className="board">
              {(
                [
                  ["ban", "Bannis", state.bans],
                  ["ally", "Nous", state.allies],
                  ["enemy", "Eux", state.enemies],
                ] as [Slot, string, string[]][]
              ).map(([k, label, ids]) => (
                <div key={k} className={`col ${k} ${slot === k ? "active" : ""}`} onClick={() => setSlot(k)}>
                  <h3>{label}</h3>
                  {ids.map((id) => (
                    <Chip key={id} id={id} name={name(id)} onRemove={() => remove(id)} />
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="reco">
            <h2>{mainList.title}</h2>
            {map && !db.mapStats[map.id] && (
              <p className="hint">Pas encore de statistiques pour cette map : les conseils reposent sur les contres et synergies seulement.</p>
            )}
            <div className="tiles recoTiles">
              {mainList.items.slice(0, 8).map((r, i) => (
                <Tile
                  key={r.brawlerId}
                  id={r.brawlerId}
                  name={name(r.brawlerId)}
                  onClick={() => add(r.brawlerId)}
                  badge={`${i + 1}`}
                  sub={r.reasons
                    .filter((x) => Math.abs(x.value) >= 0.3)
                    .map((x) => `${x.label} ${x.value >= 0 ? "+" : ""}${x.value.toFixed(1)}`)
                    .join(" · ")}
                />
              ))}
            </div>
            {phase === "theirPick" && picks.length > 0 && (
              <p className="hint">
                Pour notre prochain tour : <b>{picks.slice(0, 3).map((r) => name(r.brawlerId)).join(", ")}</b>
              </p>
            )}
          </section>

          <section className="picker">
            <input
              ref={inputRef}
              className="bigInput"
              autoFocus
              placeholder={`Tapez la 1re lettre… Entrée = 1er résultat · ajout dans « ${slot === "ban" ? "Bannis" : slot === "ally" ? "Nous" : "Eux"} »`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") return setQuery("");
                if (e.key !== "Enter" || !query.trim()) return;
                const firstFree = brawlerResults.find((b) => !taken.has(b.id));
                const isPhrase = query.trim().includes(" ");
                const cmds = isPhrase || !firstFree ? parseUtterance(query, db, slot) : [];
                if (cmds.length) setState((s) => cmds.reduce(applyCommand, s));
                else if (firstFree) add(firstFree.id);
                setQuery("");
              }}
            />
            <div className="tiles">
              {brawlerResults.map((b) => (
                <Tile
                  key={b.id}
                  id={b.id}
                  name={b.name}
                  disabled={taken.has(b.id)}
                  onClick={() => {
                    add(b.id);
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {showOwned && (
        <section className="owned">
          <h2>Ma collection</h2>
          <p>Cochez les brawlers que vous possédez. Aucun coché : tous sont proposés.</p>
          <div className="grid">
            {db.brawlers.map((b) => (
              <label key={b.id} className="check">
                <input
                  type="checkbox"
                  checked={ownedSet.has(b.id)}
                  onChange={(e) =>
                    setOwned((o) => (e.target.checked ? [...o, b.id] : o.filter((x) => x !== b.id)))
                  }
                />
                {b.name}
              </label>
            ))}
          </div>
        </section>
      )}

      <footer>
        Données : {db.sources.join(", ")} · mises à jour le {new Date(db.generatedAt).toLocaleDateString("fr-FR")}.
        Application non officielle, sans lien avec Supercell.
      </footer>
    </main>
  );
}
