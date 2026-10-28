## 🎥 Explainer video

**Walkthrough of this directory:** https://www.loom.com/share/10be9dbff9fa4176b41690a1d007e010

---

# Ken Research Content Distribution Agent

Automatically distributes Ken Research content (blogs, reports, social posts) across dozens of platforms and 45+ accounts on a cron schedule, writes the resulting URLs back to Google Sheets, and monitors and repairs itself when posting fails.

## How it works

```
Google Sheets (source rows)
  -> src/scheduler-new.ts          cron daemon (Asia/Kolkata), DAILY_SLOTS table
    -> src/coordinator/masterCoordinator.ts   batch runners
      -> src/agents/seoAgentNew.ts            SEO ranking + priority
      -> src/agents/contentAgentNew.ts        platform-specific content generation
      -> src/browser/<platform>/poster.ts     posting via Playwright
    -> src/sheets/sheets.ts        results + URLs written back
    -> src/errorInterceptor.ts     errors logged to the knowledge base
    -> src/monitor.ts              diagnosis + auto-fix
```

## Tech stack

- TypeScript on Node.js (ES modules, run through `tsx`)
- Playwright with persistent Chrome profiles (`.sessions/`)
- Content generation: OpenRouter (key rotation), NVIDIA NIM fallback, ChatGPT browser flows
- SEO: SerpAPI / Zenserp / Serpstack, Tavily
- Scheduling: node-cron (IST)
- Data: Google Sheets API
- Validation: Zod

## Repository layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point with the CLI modes |
| `src/scheduler-new.ts` | Cron daemon; `DAILY_SLOTS` drives both cron and catch-up |
| `src/batchLedger.ts` | Slot ledger, missed-slot catch-up sweeper, heartbeat |
| `src/supervisor.ts` | Restarts a frozen daemon via the heartbeat watchdog |
| `src/agents/` | Content, SEO and per-platform batch agents |
| `src/browser/<platform>/` | `login.ts` and `poster.ts` for each platform |
| `src/config/` | Accounts, key rotation, settings |
| `src/sheets/` | Google Sheets read/write |
| `src/reportDiscovery/` | Watches the Ken Research sitemaps and RSS for new reports |
| `src/newsletter-outlook/` | Newsletter generation and sending |
| `scripts/` | One-off and daily batch scripts |
| `content-engine/` | Blog and image generation engine (its own git repo) |
| `docs/` | Playbooks, known issues and pipeline docs |
| `prompts/` | Prompt templates |

## Getting started

```bash
npm install
# create a .env file first; see "Configuration"
npm run dev:supervised   # start the cron daemon under the watchdog (preferred)
```

## Common commands

```bash
npm run dev              # start the cron daemon
npm run dev:supervised   # cron daemon under the heartbeat supervisor
npm run ledger           # today's slot ledger (done / running / error)
npm run once             # run once immediately
npm run accounts         # manage X accounts
npm run login            # log in to an account
npm run generate:daily   # generate blogs and newsletters in parallel
```

## Configuration

Secrets are never committed. Provide them through `.env` and the `.accounts/` folder.

- `OPENROUTER_API_KEY_1..15`, `NVIDIA_API_KEY_1..4` for content generation
- `SERPAPI_KEY_*`, `ZENSERP_API_KEY_*`, `SERPSTACK_API_KEY_*`, `TAVILY_API_KEY_*` for SEO and search
- `.accounts/google-service-account.json` for Google Sheets access
- Per-platform account credentials as JSON files in `.accounts/`

## Operating notes

- Keep the daemon supervised so a stalled run is restarted and missed slots are caught up.
- Use plain Playwright for logins, not Stagehand.
- Wait for a selector before using it, and keep `humanDelay` between browser actions.
- Bug-fix procedure is in [docs/REPAIR-PLAYBOOK.md](docs/REPAIR-PLAYBOOK.md); known issues are in [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).
- Further context: [CLAUDE.md](CLAUDE.md), [PRD_RSS_Content_Distribution.md](PRD_RSS_Content_Distribution.md), [docs/BLOG-GENERATION-PIPELINE.md](docs/BLOG-GENERATION-PIPELINE.md).
