# Week 4 submission checklist

Read on 2026-10-28. This is a checklist for the DEV Hacktoberfest Open-Source AI Challenge, Week 4, "Ghost in the Machine". It is not a submission.

Sources:

- [Week 4 contest rules](https://dev.to/page/hacktoberfest-week4-2026-10-26-contest-rules) — entry period, one entry, required elements, judging
- [Week 4 challenge page](https://dev.to/challenges/hacktoberfest-week4-2026-10-26) (DEV event 82) — template, required tags, footer deadline
- [Announcement](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-ghost-in-the-machine-2850-in-prizes-across-21-3cho) by [The DEV Team](https://dev.to/devteam) — same template prefill
- [HF26 hub](https://dev.to/challenges/hf26) — category paragraphs and the shared FAQ
- DevRelay knowledge guide `dev-challenges` (verified 2026-09-30) for the [Official Rules](https://dev.to/page/official-hackathon-rules). Where that guide and a challenge page disagree, the challenge page wins. The contest rules page says the Official Rules win if they conflict with the contest page.

DevRelay returned event 82 `full_details` and the announcement. `/api/events/hf26` and `/api/pages/1269` were 404, so the hub and the contest-rules page were read from the public HTML. Nothing here was drafted or published on DEV.

## Deadline

Contest rules, verbatim:

> Entry Period: The Contest begins on October 26, 2026 at 9:00 AM PDT and ends on October 31, 2026 at 11:59 PM PDT (the "Entry Period")

The challenge-page footer repeats: "Contest entry period ends October 31, 2026 at 11:59 PM PDT."

DEV event `end_time` and the MLH Week 4 `ends_at_utc` are both `2026-10-31T06:59:00Z` (11:59 PM PDT on October 30). DEV `start_time` is `2026-10-26T19:00:00Z` (12:00 PM PDT). The MLH start `2026-10-26T16:00:00Z` matches 9:00 AM PDT. This checklist uses the contest-rules sentence.

## Template headings

The challenge-page prefill uses these headings, verbatim:

```markdown
## What I Built
## Demo
## Code
## How I Built It
## Why Does Open Innovation Matter?
## My Agent Session
## The Spirit of It
## Prize Categories
```

Front matter in that prefill: `tags: devchallenge, hf26challenge`. The challenge page says the template adds the required tags `#devchallenge` and `#hf26challenge`. Event `full_details` names only `#hf26challenge`. The opener is: *This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 4: Ghost in the Machine](https://dev.to/challenges/hacktoberfest-week4-2026-10-26)*.

The template comments mark **My Agent Session** and **The Spirit of It** as optional, and say to drop **Prize Categories** when none apply. The contest rules still require that section when the entry is in a prize category.

## Eligibility and judging

- One entry. A later post is ignored; only the first is judged.
- A new project, created during the Entry Period, built with open-weight models and/or open-source AI (an open-source agent harness or framework, or local inference), on the Ghost in the Machine theme. The theme text: "Whatever you pick, the open pieces should be what makes your project work."
- The hub FAQ adds: the repository must be started and completed in the window, and commits after the deadline must be noted in the README.
- The post needs a demo (deployed link or video), a link to the code, which open-source AI was used, how the project is built around it, and why open innovation matters.
- One project can enter every prize category whose technology it meaningfully uses. Each participant can win once. Name the categories in the post.
- Judging, from the contest rules: Writing Quality (weighted most heavily), Relevance to the Prompt and Theme, Creativity, Technical Execution, Use of Partner Technology (prize categories only). A tie goes to the post with the most positive reactions.
- From the Official Rules summary in the knowledge guide: 18+, DEV member in good standing, and not in an excluded jurisdiction (Afghanistan, Belarus, Central African Republic, Cuba, Equatorial Guinea, Iran, Iraq, Kosovo, Libya, Myanmar (Burma), North Korea, Russia, South Sudan, Sudan, Syria, Tanzania, Venezuela, Yemen, plus US restricted-party lists). Teams of up to four; list DEV handles in the post. Non-English posts can earn a completion badge and are not prize-eligible. A license is recommended, not required. Exorcist is MIT.

## Category requirements

No extra tag is stated for these four. Opt in by using the technology and listing the category under **Prize Categories**.

**Best Use of Gemma** (featured). "Use Gemma, Google's open-weight model, in building your project: run it locally, fine-tune it, or serve it through Google Cloud or another provider."

**Best Use of Mastra** (partner). "Orchestrate an agent over open models, add memory and tools to a chat agent, or build a workflow that triages GitHub issues."

**Best Use of Sentry Agent Tracing** (partner). "Show your agent's work: how it's set up, how it performs (latency, tokens, cost), what you found, and how you debugged it. Include traces or screenshots in your write-up."

**Best Use of a .tech Domain** (partner). "Put your project live on a .tech domain you claimed through Hacktoberfest, and link to it in your write-up. Claim a free first-year .tech domain at hacktoberfest.com/my/promos (it renews at $29.99 a year)."

## Exorcist status

From `docs/STATUS.md`, `docs/ARCHITECTURE.md`, and `README.md`.

| Requirement | Status |
| --- | --- |
| First commit `d1eaa75` is 2026-10-27, inside the Entry Period | done |
| Local Gemma (`gemma3:4b` via Ollama) judges suspects. Not fine-tuned, not served on Google Cloud. Local is one of the three Gemma modes. | done |
| The open model is what makes the project work | todo in the write-up. The scan still writes a rules-only report when Ollama is down or `--no-oracle` is set. Gemma can raise the score and cannot lower it. |
| Mastra workflow `haunt` (`src/workflow.ts`) runs resolve, rules, the judge, and the score. The judge (`src/judge.ts`) is a Mastra agent over Gemma, with structured output, no tools, and no memory. | done for "orchestrate an agent over open models". Memory, tools, and GitHub-issue triage are not in this repo. `gemma3:4b` on Ollama returns HTTP 400 if given tools. |
| Sentry traces or screenshots of setup, latency, tokens, cost, and debugging | code is opt-in via `SENTRY_DSN` (`src/tracing.ts`, Mastra `SentryExporter`). Screenshots for the write-up are still todo. No DSN is committed. |
| A live `.tech` name claimed through Hacktoberfest, linked in the post | todo. This file does not claim that promo. |
| One published DEV post: template, both tags, demo link or video, repo link, theme, and the four category names | todo. `demo/victim` is a local demo, not a deployed URL or a video. |
| Optional agent-session embed | todo. See below. |

## Agent sessions

Optional. The challenge page asks you to save a session with DevRelay and embed it, or link to it.

DevRelay's `submit_agent_session` takes a title, `curated_data` (`messages`, optional `metadata`), an optional `s3_key`, and `tool_name`. The sessions skill lists supported `tool_name` values as `gemini_cli`, `claude_code`, `codex`, `github_copilot`, `opencode`, and `pi`. Cursor is not in that list. This session did not submit a transcript, so Cursor support was not tested.

Embeds from that skill:

```liquid
{% agent_session 42 %}
{% agent_session 42 0..5 %}
{% agent_session 42 root-cause-investigation %}
```

A draft session can be embedded only by its author. Once it is published, any author can embed it. Scrub secrets before a submit.
