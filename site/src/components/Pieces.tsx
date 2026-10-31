import { motion, useInView } from "framer-motion";
import { Check, Copy, Eye, Footprints, Ghost, Skull } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { Ghost as GhostRule, Verdict } from "../data";

const icons = {
  poltergeist: Skull,
  doppelganger: Eye,
  phantom: Ghost,
  revenant: Footprints,
};

/** Fades a block in on first sight. Reduced-motion readers get it at rest. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={seen ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/** A figure caption, the way a technical write-up labels an exhibit. */
export function Fig({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="fig">
      <b>[{n}]</b> {children}
    </p>
  );
}

export function BestiaryCell({ ghost, area }: { ghost: GhostRule; area: string }) {
  const Icon = icons[ghost.icon];
  const lead = area === "lead";
  return (
    <motion.article
      className={`cell ${area}`}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
    >
      <span className="cell-label">
        <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
        case · {ghost.icon}
        <span className="sev">{ghost.severity}</span>
      </span>
      <h3>{ghost.name}</h3>
      <p className="blurb">{ghost.blurb}</p>
      <p className="signals">{ghost.signals}</p>
      {lead && ghost.snippet && (
        <div className="snippet">
          {ghost.snippet.before}
          <span className="hit">{ghost.snippet.hit}</span>
          {ghost.snippet.after}
        </div>
      )}
    </motion.article>
  );
}

/**
 * One bar carrying all three numbers: the rule floor as the filled span, the
 * model's answer as a tick. Where the tick sits left of the fill, the model
 * was overruled.
 */
function Scale({ floor, model }: { floor: number; model: number }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: "-40px" });
  const reported = Math.max(floor, model);
  return (
    <div className="scale" ref={ref}>
      <div className="scale-track">
        <motion.span
          className="scale-floor"
          initial={{ width: 0 }}
          animate={seen ? { width: `${floor}%` } : undefined}
          transition={{ duration: 0.75, ease: "easeOut" }}
        />
        <span className="scale-model" style={{ left: `calc(${model}% - 1px)` }} />
      </div>
      <div className="scale-key">
        <span className="k">
          <i className="swatch" style={{ background: "var(--accent)" }} /> rule floor {floor}
        </span>
        <span className="k">
          <i className="swatch" style={{ background: "var(--warn)" }} /> gemma {model}
        </span>
        <span className="k">reported {reported}</span>
      </div>
    </div>
  );
}

export function VerdictSplit({ verdict, flip }: { verdict: Verdict; flip: boolean }) {
  const reported = Math.max(verdict.ruleFloor, verdict.modelScore);
  return (
    <Reveal>
      <div className={`verdict-split${flip ? " flip" : ""}`}>
        <div className="numeral">
          <span className="n">{reported}</span>
          <span className="of">reported score / 100</span>
          <span className="pkg">{verdict.pkg}</span>
          <span className="pill">{verdict.label}</span>
        </div>
        <div className="pull">
          <blockquote>“{verdict.quote}”</blockquote>
          <Scale floor={verdict.ruleFloor} model={verdict.modelScore} />
          <p className="note">{verdict.note}</p>
        </div>
      </div>
    </Reveal>
  );
}

export function CommandRow({ cmd, big = false }: { cmd: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`cmd${big ? " big" : ""}`}>
      <code>{cmd}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(cmd).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            },
            () => {},
          );
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
