# AGENTS.md

Operational knowledge for any AI coding agent working on this repo (Claude Code, Codex, Cursor, Continue.dev, Aider, etc.). Claude Code users get a richer SKILL.md auto-loaded; this file is the universal subset everyone reads.

## What this project is

`daily-brief` is a local-first pipeline that fetches 23 RSS / API news sources daily (22 in en mode after locale filtering), runs LLM enrichment, and renders a single self-contained HTML report. It runs on the user's machine via the OS scheduler, OR in GitHub Actions publishing to GitHub Pages. No web framework, no DB, no servers.

The repo's `CLAUDE.md` includes this file via `@AGENTS.md`. Don't add stack-specific lore (Next.js, etc.) — there's none in this codebase.

## Project layout (essentials)

```
lib/
  ai/           # LLM dispatcher + 5 backend implementations + prompts
  sources/      # fetcher dispatch + per-source TS modules
  trading/      # Yahoo finance + technical indicators + watchlist
  output/       # render.ts (HTML+MD generation), all CSS inlined
  utils.ts      # tiny shared helpers (todayKey, getReportTz)
scripts/
  _env.ts             # dotenv preload — imported FIRST by every entry script
  daily.ts            # main pipeline (5-8 min, ~6 LLM calls)
  dry-run.ts          # fetch-only validation (~30s, no LLM)
  render.ts           # re-render HTML/MD from cached sidecar (~1s)
  regen-trading.ts    # rerun just the trading commentary
  regen-enrich.ts     # top up missing summaries for a subgroup
  build-site.mjs      # generate index.html + archive.html for static hosting
  deploy.mjs          # scp HTML to a remote nginx host (opt-in)
  sources.ts          # `npm run sources` — list/validate sources.config.json
  install.mjs         # cross-platform OS scheduler registration
  run-daily.mjs       # scheduler wrapper (daily + log + deploy + open)
  open-report.mjs     # cross-platform "open latest report" helper
  uninstall.mjs       # tear down scheduler + ~/.claude/ links
  quota-report.ts     # LLM call usage summary
sources.config.json   # SINGLE SOURCE OF TRUTH for the source registry
```

## Core invariants

1. **`sources.config.json` is the only place sources live.** `lib/sources/registry.ts` is just a JSON loader + locale filter. Never hardcode a source list in TS.

2. **LLM calls go through `lib/ai/llm.ts` `runLlm()`.** Five backends behind `LLM_BACKEND` env var: `claude-cli` (default), `anthropic`, `openai`, `deepseek`, `minimax`. Never import a specific backend directly — that defeats the switch.

3. **Date keying uses `lib/utils.ts` `todayKey()`.** Honors `REPORT_TZ` env var; defaults to system local TZ. Don't hardcode `Asia/Shanghai` or `UTC` anywhere.

4. **Localization via `REPORT_LOCALE` (`zh` | `en`).** All UI text in render.ts goes through `STR.<key>`; LLM prompts have ZH/EN pairs picked at module-init. When adding strings, add both.

5. **Per-source fetch errors are non-fatal.** `scripts/daily.ts` has a try/catch per source. Never `process.exit()` inside a fetcher.

6. **No agent-specific build steps.** No `next build`, no bundling. `tsx` runs TS directly. The HTML is hand-rendered, CSS is inlined string-templated.

## Commands

| Task | Command | Cost |
|---|---|---|
| Full pipeline | `npm run daily` | ~5-8 min, ~6 LLM calls |
| Fetch-only sanity check | `npm run dry-run` | ~30s, no LLM |
| Re-render from cache | `npm run render [date]` | <1s |
| Re-run trading section | `npm run regen-trading [date]` | ~2 min, 1 LLM call |
| Top up missing summaries | `npm run regen-enrich <cat:sub> [date]` | ~30s, 1 LLM call |
| Static-site generator | `npm run build-site` | <1s |
| List sources by status | `npm run sources` | instant |
| Validate sources.config.json | `npm run sources:check` | instant |

`[date]` defaults to today in `REPORT_TZ`. Output is `daily_reports/<date>/<date>.html` + `<date>.json` + `<date>-articles.json` (note the hyphen in the articles cache filename); add `<date>.md` if `OUTPUT_MARKDOWN=true`.

## Adding a source

1. Edit `sources.config.json` — append an entry. Fields: `id` (unique), `name`, `type` (`rss`/`api`/`scrape`), `url`, `category` (`tech`/`finance`/`politics`), optional `subcategory`, `enabled`, `useCurl`, `lang`, `locales`, `notes`.
2. For non-RSS types: add a fetcher in `lib/sources/<id>.ts` exporting `fetchXxx(sourceId)` returning `RawArticle[]`, then add a branch in `lib/sources/dispatch.ts`.
3. Run `npm run sources:check` to validate the JSON, then `npm run dry-run` to verify the fetch.

## Adding an LLM backend

1. New file `lib/ai/backends/<name>.ts` exporting a function compatible with the existing backends (see `claude-cli.ts` as the minimum reference).
2. Add a branch in `lib/ai/llm.ts` `runLlm()`.
3. Add `<NAME>_API_KEY` + optional `<NAME>_BASE_URL` to `.env.example`.

## Debugging a failed run

1. `logs/daily-<YYYY-MM-DD>.log` — full pipeline output for that day (date in local time, NOT UTC)
2. `logs/llm-calls.jsonl` — every LLM call with input size, latency, success, error category
3. `npm run quota-report` — usage summary by backend
4. If a tab renders wrong but the data is right, `npm run render` (1s) usually fixes display-only bugs without rerunning LLM

## What NOT to do

- Don't add Playwright / Puppeteer for fetching — the project stays light with curl + JSON APIs
- Don't import a specific LLM backend module directly; always go through `runLlm`
- Don't hardcode sources in TS — use `sources.config.json`
- Don't write into `daily_reports/` directly from agent code; let `scripts/daily.ts` or `render.ts` own that
- Don't add a web framework (Next.js, Express, etc.) — the project is intentionally static
- Don't bypass the per-source try/catch — let `daily.ts` aggregate failures

## Where to learn more

- `README.md` — user-facing intro, install, configuration
- `FORKING.md` — common customizations (LLM provider, sources, layout, styling)
- `.claude/skills/daily-brief/SKILL.md` — fuller operational reference (Claude Code auto-loads it; other agents can read it directly)
- `sources.config.json` — see what sources look like in practice

## Cursor Cloud specific instructions

Node 22 is preinstalled and works (README says 20+). The update script runs `npm install`; no build step exists (`tsx` runs the TS directly).

There is no `eslint` config and no unit-test framework. For a "does it compile" check use `npx tsc --noEmit`. The closest thing to a test is `npm run sources:check` (validates `sources.config.json`).

`npm run dry-run` is the safe way to exercise the app end-to-end here: it fetches all enabled sources over the live network (~60s, ~500+ articles) and makes **no LLM calls**, so it needs no credentials.

The full pipeline (`npm run daily`, `npm run regen-trading`, `npm run regen-enrich`) and any command that hits the LLM will **not** run in a bare cloud VM: there is no `claude` CLI and no API keys. `daily` fails fast (<1s) with a clear message from `validateBackendCredentials`. To generate a real report, set an LLM backend first (e.g. `LLM_BACKEND=deepseek` + `DEEPSEEK_API_KEY=…`, or any backend from the README's LLM table) via env vars or `.env.local`.

`npm run render [date]` only works after a `npm run daily` for that date has written the `daily_reports/<date>/<date>.json` + `<date>-articles.json` cache; it cannot render from nothing.

Model choice gotcha (OpenAI-compatible gateways such as OpenCode Zen/Go): the `openai` backend sends a fixed `max_tokens: 8192` (`lib/ai/backends/openai-compat.ts`). Heavy **reasoning** models spend that entire budget on `reasoning_content` and return empty `content`. The small enrichment calls survive, but the large digest call (~24k input chars) comes back empty and `npm run daily` dies at the JSON.parse in `pipeline.ts`. Fix: point `LLM_MODEL` at a **non-reasoning** chat/completions model (verified end-to-end on the gateway's `/models` list). To use such a gateway set `LLM_BACKEND=openai` plus `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (see README's LLM table). Note: GPT-5.x models are unusable here — they require the `/v1/responses` endpoint, which this backend does not call.
