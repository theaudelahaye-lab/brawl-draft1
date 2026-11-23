import { useCallback, useEffect, useRef, useState } from "react";

// API Web Speech (Chrome, Edge, Safari). Typage minimal, non fourni par TS.
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; length: number } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getCtor(): (new () => SR) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SR) | null;
}

/** onFinal reçoit les variantes comprises, de la plus probable à la moins probable. */
export function useSpeech(onFinal: (alternatives: string[]) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const cbRef = useRef(onFinal);
  useEffect(() => {
    cbRef.current = onFinal;
  }, [onFinal]);
  const supported = typeof window !== "undefined" && !!getCtor();

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) cbRef.current(Array.from({ length: r.length }, (_, k) => r[k].transcript));
        else tmp += r[0].transcript;
      }
      setInterim(tmp);
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(e.error);
    };
    // Chrome coupe l'écoute après un silence : on relance tant que le micro est voulu.
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          /* déjà relancé */
        }
      } else setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    setError(null);
    rec.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  return { supported, listening, interim, error, start, stop };
}
