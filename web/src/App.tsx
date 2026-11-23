import { useCallback, useEffect, useMemo, useState } from "react";
import type { Db, DraftState } from "./types";
import { currentPhase, enemyThreats, picksThisTurn, recommendBans, recommendPicks, type Reco } from "./engine";
import { normalize, parseUtterance, type Command } from "./voice";
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
    case "map":
      return { ...s, mapId: c.ids[0] };
    case "undo":
    case "unban":
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

function Chip({ id, name, onRemove }: { id: string; name: string; onRemove?: () => void }) {
  return (
    <span className="chip" style={{ ["--h" as string]: hue(id) }}>
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

  const onHeard = useCallback(
    (text: string) => {
      if (!db) return;
      setLastHeard(text);
      const fallback = slot === "ban" ? "ban" : slot === "ally" ? "ally" : "enemy";
      const cmds = parseUtterance(text, db, fallback);
      setState((s) => cmds.reduce(applyCommand, s));
    },
    [db, slot],
  );
  const speech = useSpeech(onHeard);

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
  const mapResults = q ? db.maps.filter((m) => normalize(`${m.name} ${m.mode}`).includes(q)).slice(0, 8) : [];
  const brawlerResults = db.brawlers.filter((b) => !q || normalize(b.name).includes(q));
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

      <section className="voice">
        {speech.supported ? (
          <button className={`mic ${speech.listening ? "on" : ""}`} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.listening ? "● J'écoute" : "🎤 Activer la voix"}
          </button>
        ) : (
          <p className="warn">Reconnaissance vocale non disponible : utilisez Chrome ou Edge.</p>
        )}
        <p className="heard">
          {speech.interim || lastHeard || "Ex. : « map Safe Zone, bannis Mortis et Spike, en face Colt »"}
        </p>
        {speech.error && <p className="warn">Micro : {speech.error}</p>}
      </section>

      <section className="status">
        <div>
          <strong>{map ? `${map.name} · ${map.mode}` : "Map inconnue"}</strong>
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
        {phase === "map" && <p>Choisissez ou dites la map pour obtenir des conseils.</p>}
        <ol>
          {mainList.items.slice(0, 8).map((r) => (
            <li key={r.brawlerId} onClick={() => add(r.brawlerId)}>
              <Chip id={r.brawlerId} name={name(r.brawlerId)} />
              <span className={`score ${r.score < 0 ? "neg" : ""}`}>{r.score >= 0 ? "+" : ""}{r.score.toFixed(1)}</span>
              <span className="why">
                {r.reasons
                  .filter((x) => Math.abs(x.value) >= 0.3)
                  .map((x) => `${x.label} ${x.value >= 0 ? "+" : ""}${x.value.toFixed(1)}`)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
        {phase !== "ban" && phase !== "map" && phase !== "done" && phase !== "ourPick" && picks.length > 0 && (
          <p className="hint">
            Pour notre prochain tour : <b>{picks.slice(0, 3).map((r) => name(r.brawlerId)).join(", ")}</b>
          </p>
        )}
      </section>

      <section className="picker">
        <input
          placeholder={`Rechercher une map ou un brawler (ajout dans « ${slot === "ban" ? "Bannis" : slot === "ally" ? "Nous" : "Eux"} »)`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {mapResults.length > 0 && (
          <div className="grid">
            {mapResults.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setState((s) => ({ ...s, mapId: m.id }));
                  setQuery("");
                }}
              >
                {m.name} <small>{m.mode}</small>
              </button>
            ))}
          </div>
        )}
        <div className="grid">
          {brawlerResults.map((b) => (
            <button key={b.id} disabled={taken.has(b.id)} onClick={() => (add(b.id), setQuery(""))}>
              {b.name}
            </button>
          ))}
        </div>
      </section>

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
