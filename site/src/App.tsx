import { motion, useInView } from "framer-motion";
import { ArrowDown, Github } from "lucide-react";
import { useRef } from "react";
import { BestiaryCell, CommandRow, Fig, Reveal, VerdictSplit } from "./components/Pieces";
import { Terminal } from "./components/Terminal";
import { ghosts, ONELINER, REPO, scanLines, selfScan, steps, verdicts } from "./data";

const areas = ["lead", "b", "c", "d"];

function RuleBar({ rule, count, of }: { rule: string; count: number; of: number }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: "-40px" });
  return (
    <div className="rulebar" ref={ref}>
      <span className="name">{rule}</span>
      <span className="track">
        <motion.span
          className="fill"
          initial={{ width: 0 }}
          animate={seen ? { width: `${(count / of) * 100}%` } : undefined}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </span>
      <span className="n">{count}</span>
    </div>
  );
}

export default function App() {
  return (
    <>
      <div className="fog" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {/* 1 — hero: a name, a claim, and the one line that starts a scan. */}
      <header className="band hero ink" style={{ borderTop: 0 }}>
        <div className="inner">
          <p className="eyebrow">Hacktoberfest 2026 · Week 4 · Ghost in the Machine</p>
          <h1 className="title">
            Exorcist
            <motion.span
              className="flame"
              animate={{ opacity: [1, 1, 0.66, 1, 0.87, 1] }}
              transition={{ duration: 4.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            >
              .
            </motion.span>
          </h1>
          <p className="tagline">
            Your agent runs <code>npm install</code>. Something you have never read starts executing
            on your machine.
          </p>
          <p className="lede">
            Exorcist reads your <code>package-lock.json</code>, walks every installed package on
            disk, and looks for four things that go wrong in supply-chain attacks. Anything a rule
            flags is handed to a Gemma model running locally, which reads the actual code against
            what the package claims to be and returns a verdict, a score out of 100, and a reason.
            Each package comes back with one of three fixes: <b>pin</b>, <b>swap</b>, or{" "}
            <b>remove</b>.
          </p>

          <dl className="spec">
            <div className="spec-row">
              <dt>Looks for</dt>
              <dd>
                <b>Poltergeist</b> install hooks and risky APIs · <b>Doppelganger</b> typosquats ·{" "}
                <b>Phantom</b> dependencies nothing imports · <b>Revenant</b> releases after a long
                silence or under a new maintainer
              </dd>
            </div>
            <div className="spec-row">
              <dt>The model</dt>
              <dd>
                <b>gemma3:4b</b> through Ollama, on your hardware. Optional — with{" "}
                <code>--no-oracle</code>, or with Ollama down, the scan still finishes from the
                rules alone.
              </dd>
            </div>
            <div className="spec-row">
              <dt>Leaves the box</dt>
              <dd>
                One npm registry lookup, for release dates and maintainers.{" "}
                <b>No code or source is uploaded anywhere.</b> The scanner never executes the
                packages it reads.
              </dd>
            </div>
            <div className="spec-row">
              <dt>Output</dt>
              <dd>
                A terminal report, <code>haunting-report.md</code>, and <code>--json</code> on
                stdout for a pipeline. Exit code is 0 for a finished scan.
              </dd>
            </div>
            <div className="spec-row">
              <dt>Requires</dt>
              <dd>
                Node 22.13+ · npm lockfile v2 or v3 · MIT licensed · 117 tests · zero npm advisories
              </dd>
            </div>
          </dl>

          <CommandRow cmd={ONELINER} big />
          <div className="hero-cta">
            <a className="btn primary" href="#scan">
              <ArrowDown size={14} /> Watch a scan
            </a>
            <a className="btn" href={REPO}>
              <Github size={14} /> Source
            </a>
          </div>
        </div>
      </header>

      {/* 2 — the exhibit. Widest band on the page; the output is the product. */}
      <section className="band deep wide" id="scan">
        <div className="inner">
          <Fig n="fig. 01">exorcist demo/victim --no-oracle · recorded, rules only, no model</Fig>
          <Terminal lines={scanLines} />
        </div>
      </section>

      {/* 3 — bestiary: one rule leads, three follow. */}
      <section className="band ink" id="ghosts">
        <div className="inner">
          <Fig n="the bestiary">four rules · the cheap filter that picks who the model sees</Fig>
          <h2 className="section-title">Nothing here runs your packages</h2>
          <p className="section-intro">
            Rules are regexes and lockfile arithmetic. They read files and publish dates, they
            decide who is worth waking the model for, and they are the floor a verdict cannot sink
            below.
          </p>
          <div className="bestiary">
            {ghosts.map((ghost, index) => (
              <BestiaryCell key={ghost.name} ghost={ghost} area={areas[index] ?? "b"} />
            ))}
          </div>
        </div>
      </section>

      {/* 4 — the verdicts, as pull quotes with the number set large. */}
      <section className="band violet" id="oracle">
        <div className="inner">
          <Fig n="fig. 02">gemma3:4b · ollama 0.40.11 · captured verbatim into test/fixtures</Fig>
          <h2 className="section-title">The model gets a vote, not a veto</h2>
          <p className="section-intro">
            Gemma reads only the packages a rule already flagged. It can push a score above the rule
            floor. It can never pull one below.
          </p>
          {verdicts.map((verdict, index) => (
            <VerdictSplit key={verdict.pkg} verdict={verdict} flip={index % 2 === 1} />
          ))}
          <Reveal>
            <p className="callout" style={{ marginTop: "1.5rem" }}>
              On <code>lodasg</code> the model answered 42 and the report still says 28. The prompt
              asks for 40 or below on impersonation; the model went over, and the floor logic
              discarded it. That overshoot is recorded as a fixture rather than smoothed away.
            </p>
          </Reveal>
        </div>
      </section>

      {/* 5 — the honest number, given the weight of a benchmark. */}
      <section className="band raised" id="honest">
        <div className="inner">
          <Fig n="fig. 03">this repository's own dependencies · rules only</Fig>
          <h2 className="section-title">It is noisy. That is the honest part.</h2>
          <div className="ratio">
            <div className="ratio-nums">
              <div className="ratio-num all">
                <div className="n">{selfScan.packages}</div>
                <div className="k">packages</div>
              </div>
              <div className="ratio-num flagged">
                <div className="n">{selfScan.haunted}</div>
                <div className="k">flagged</div>
              </div>
            </div>
            <div className="rulebars">
              {selfScan.byRule.map((row) => (
                <RuleBar
                  key={row.rule}
                  rule={row.rule}
                  count={row.count}
                  of={selfScan.byRule[0]?.count ?? 1}
                />
              ))}
            </div>
          </div>
          <p className="callout" style={{ marginTop: "2rem" }}>
            Most of those are revenant findings at <code>pin</code> — a package that shipped again
            after a long silence, which is suspicious and also completely normal. One is a real
            false positive: <code>trough</code> read as a typosquat of <code>through</code>. A
            scanner claiming a clean bill of health on 346 packages is not telling you the truth.
          </p>
        </div>
      </section>

      {/* 6 — the stack, as rows rather than another card grid. */}
      <section className="band ink" id="built">
        <div className="inner">
          <Fig n="the stack">open pieces, all the way down</Fig>
          <dl className="stack">
            <div className="stack-row">
              <dt>Gemma 3 4B</dt>
              <dd>
                The only model in the project, local through Ollama. Structured JSON out: verdict,
                confidence, score, reason. Package text is fenced as untrusted data, so a malicious
                README cannot argue its way to a pass.
              </dd>
            </div>
            <div className="stack-row">
              <dt>Mastra</dt>
              <dd>
                The scan is a workflow of five steps — resolve, rules, prepare, judge, score. The
                judge is a Mastra agent over that open model, with structured output and no tools:{" "}
                <code>gemma3:4b</code> answers a tools array with HTTP 400, which is recorded as a
                fixture rather than asserted.
              </dd>
            </div>
            <div className="stack-row">
              <dt>Sentry</dt>
              <dd>
                Every judge call is a span with its latency and token counts. Opt-in behind{" "}
                <code>SENTRY_DSN</code>, metadata only unless you ask for more.
              </dd>
            </div>
            <div className="stack-row">
              <dt>Why local</dt>
              <dd>
                A package scanner has to read untrusted code. Pipe that to a cloud model and you
                have built a new injection target and shipped your dependency tree off the machine.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* 7 — closing band: the install repeated, where someone decides. */}
      <section className="band deep" id="install">
        <div className="inner">
          <Fig n="run it">node 22.13+ · reads package source, never executes it</Fig>
          <h2 className="section-title">Point it at your own tree</h2>
          <div className="install-grid">
            {steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 0.04}>
                <div className="step">
                  <h3>{step.title}</h3>
                  <p className="note">{step.note}</p>
                  <CommandRow cmd={step.cmd} />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <footer className="band ink">
        <div className="inner">
          <p>
            <a href={REPO}>github.com/Ackberry/exorcist</a> · MIT licensed
          </p>
          <p>
            Built for the Hacktoberfest Open-Source AI Challenge, Week 4: Ghost in the Machine.
            Every number on this page comes from a real run.
          </p>
        </div>
      </footer>
    </>
  );
}
