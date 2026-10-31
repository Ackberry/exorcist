import { useEffect, useState } from "react";
import type { Span, Tone } from "../data";

const toneClass: Record<Tone, string> = {
  plain: "",
  dim: "t-dim",
  accent: "t-accent",
  crit: "t-crit",
  warn: "t-warn",
  ok: "t-ok",
};

function Line({ spans }: { spans: Span[] }) {
  if (spans.length === 0) return <>{"\n"}</>;
  return (
    <>
      {spans.map((span, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the line is a fixed literal
        <span key={index} className={toneClass[span.tone ?? "plain"]}>
          {span.text}
        </span>
      ))}
      {"\n"}
    </>
  );
}

/**
 * Replays a recorded scan a line at a time. It is a transcript, not a live
 * run, so the pacing is cosmetic — the whole thing is in the DOM either way
 * once it finishes, and a reader who prefers no motion gets it immediately.
 */
export function Terminal({ lines }: { lines: Span[][] }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [shown, setShown] = useState(reduced ? lines.length : 0);
  const [run, setRun] = useState(0);
  // run is a replay nonce: the button bumps it to re-run the effect, which is
  // the only thing it is for, so the dependency is deliberate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: replay nonce
  useEffect(() => {
    if (reduced) {
      setShown(lines.length);
      return;
    }
    setShown(0);
    let line = 0;
    const timer = window.setInterval(() => {
      line += 1;
      setShown(line);
      if (line >= lines.length) window.clearInterval(timer);
    }, 55);
    return () => window.clearInterval(timer);
  }, [lines, reduced, run]);

  const done = shown >= lines.length;

  return (
    <div className="term">
      <div className="term-bar">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="path">exorcist demo/victim --no-oracle</span>
        <button type="button" className="replay" onClick={() => setRun((n) => n + 1)}>
          replay
        </button>
      </div>
      <div className="term-body">
        <pre aria-live="off">
          {lines.slice(0, shown).map((spans, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are a fixed literal
            <Line key={index} spans={spans} />
          ))}
          {!done && <span className="caret">_</span>}
        </pre>
      </div>
    </div>
  );
}
