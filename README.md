# social-bro

Five [elizaOS](https://docs.elizaos.ai/) agents running your social-media and content operations — **no X/Meta/YouTube developer API applications required**.

Nothing outbound ships until a human confirms it (or the sensitivity score is low enough to auto-approve). Agents also respect quiet hours, daily caps, and a manual pause command.

---

## Agents

| Agent | What it does | Live channel? |
|---|---|---|
| **Twitter Guy** | Drafts tweets, replies, follow-back review lists | No — queue only |
| **Instagram Guy** | Vertical clip captions via ffmpeg | No — queue only |
| **TG Guy** | Live Telegram support + approval desk | Yes — BotFather token |
| **YouTube Guy** | Titles, descriptions, Shorts packs, chapters | No — queue only |
| **Blog Guy** | Markdown posts and landing-page copy | No — queue only |

---

## Quick start

```bash
# Prerequisites: Node ≥ 23.3, Bun, ffmpeg (for video clips)
cp .env.example .env        # fill in at least one model key
bun install
bun run build
elizaos start               # http://localhost:3000
```

For local-only (free): set `OLLAMA_API_ENDPOINT=http://localhost:11434/api` and `OLLAMA_MODEL=llama3.2`.

---

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI / OpenRouter / any OAI-compatible |
| `OLLAMA_API_ENDPOINT` | `http://localhost:11434/api` | Local Ollama fallback |
| `OLLAMA_MODEL` | `llama3.2` | Model name to use with Ollama |
| `TELEGRAM_BOT_TOKEN` | — | BotFather token for TG Guy |
| `HITL_CHAT_IDS` | (empty = allow all) | Comma-separated Telegram chat ids allowed to issue commands |
| `DRY_RUN` | `true` | Block all outbound actions |
| `QUIET_HOURS` | `22:00-08:00` | No drafts outside these hours |
| `REST_TZ` | `UTC` | Timezone for quiet hours / rest days |
| `REST_DAYS` | — | Comma-separated days, e.g. `Sat,Sun` |
| `DAILY_DRAFT_CAP` | — | Max drafts per agent per day |
| `AUTO_APPROVE_REPLY_MAX` | `35` | Comments/replies auto-approve at this score or below |
| `AUTO_APPROVE_SUPPORT_MAX` | `25` | Bland FAQ answers auto-send at this score or below |
| `AUTO_APPROVE_POST_MAX` | `0` | Set > 0 to auto-approve simple original posts |
| `AUTO_APPROVE_FOLLOWBACK_MAX` | `0` | Follow-back lists — always HOLD by default |
| `WHATSAPP_ENABLED` | `false` | Enable Baileys WhatsApp QR login |
| `POSTGRES_URL` | — | Use Postgres instead of the default PGLite |

---

## Human-in-the-loop

You only see **HOLD** items. Low-sensitivity comments skip the queue entirely.

Talk to **TG Guy** in Telegram or at `http://localhost:3000`:

```
/pending [platform]     list items waiting for your eyes
/auto                   list items that already auto-approved
/approve <id>           confirm draft copy is OK
/edit <id> <notes>      send back to the agent with notes
/reject <id> <reason>   kill the draft (stored as feedback)
/published <id>         mark as posted (you did it in the native app)
/feedback <id> <notes>  attach notes after publishing
/status [agent]         health, rest-state, queue counts
/pause <agent>          stop drafting immediately
/resume <agent>         wake the agent
/help                   this list
```

### How sensitivity scores work

Every draft is scored 0–100 across seven risk flags:

| Flag | What triggers it |
|---|---|
| `legal-or-finance` | Refund, lawsuit, investment advice, crypto-pump, wire-transfer, SSN |
| `medical-claim` | Cure, diagnose, prescription, FDA-approved |
| `toxic` | Slurs, personal attacks |
| `engagement-bait` | "Like and retweet", follow-for-follow |
| `unverified-claim` | "Guaranteed", "#1 in the world", "100% of users" |
| `possible-pii` | Email address or phone number in the text |
| `support-escalation` | Lawsuit, attorney, BBB, chargeback, fraud — in a support context |

Auto-approval rules:

| Content type | Auto if score ≤ | Hard blocks |
|---|---|---|
| Comments / replies | `AUTO_APPROVE_REPLY_MAX` (35) | `legal-or-finance`, `support-escalation` |
| Bland support FAQ | `AUTO_APPROVE_SUPPORT_MAX` (25) | same |
| Original posts / IG / YT / blog | `AUTO_APPROVE_POST_MAX` (0) | — |
| Follow-back lists | `AUTO_APPROVE_FOLLOWBACK_MAX` (0) | — |

Feedback from reject/edit lands in `knowledge/feedback/` and improves future drafts.

---

## Video clips

Drop a video file into `media/source/`. Instagram Guy (or YouTube Guy) will ask ffmpeg to cut vertical 9:16 clips and stage captions for review.

Requires `ffmpeg` on `PATH`.

---

## WhatsApp support

Set `WHATSAPP_ENABLED=true` and install Baileys:

```bash
bun add @whiskeysockets/baileys
```

On first start, a QR code is printed to the console. Scan it with WhatsApp on your phone. Auth state is saved to `WHATSAPP_AUTH_DIR` (default `.eliza/whatsapp-auth`).

---

## Monitoring

- **Telegram** `/status` — per-agent queue counts, rest state, last heartbeat
- **HTTP** `GET http://localhost:3000/ops/status` — JSON health payload
- **File** `ops/status.json` — same payload, persisted to disk
- Automatic alerts (Telegram ping) on: agent error, daily cap reached, pending items stale > `STALE_PENDING_HOURS` hours

---

## Project layout

```
src/
  characters/          agent definitions (twitter-guy, instagram-guy, tg-guy, youtube-guy, blog-guy)
  plugins/
    content-queue.ts   pending → approved → published queue with sensitivity scoring
    ops.ts             rest, pause, /status heartbeats
    video-clips.ts     ffmpeg vertical-clip helper
    whatsapp.ts        optional Baileys plugin (gated by WHATSAPP_ENABLED)
  lib/
    sensitivity.ts     0-100 scoring + auto-approve logic
    queue.ts           file-based queue (content-queue/)
    hitl.ts            command parser + allowlist
    rest.ts            quiet hours, rest days, daily caps, cooldown
    ops-store.ts       shared ops state + Telegram alerts
    feedback.ts        feedback writer
    paths.ts           centralised path constants
knowledge/
  brand.md             voice, tone, brand rules
  support-faq.md       FAQ answers for TG Guy
  twitter-topics.md    content calendar / topic seeds
  feedback/            agent learning (gitignored, kept by .gitkeep)
content-queue/         draft files (gitignored, .gitkeep placeholders)
media/
  source/              drop raw video here (gitignored)
  clips/               ffmpeg output (gitignored)
ops/                   runtime state files (gitignored)
```

---

## Testing

```bash
bun test src/__tests__/queue.test.ts \
         src/__tests__/hitl-rest.test.ts \
         src/__tests__/sensitivity.test.ts \
         src/__tests__/social-ops.test.ts
bun test          # full suite
elizaos test      # elizaOS runtime tests
```

---

## Limitations

- **No X/Twitter posting**: `@elizaos/plugin-twitter` requires OAuth 1.0a keys. Cookie/password login is out of scope (ToS + Arkose). Approved tweets are posted manually.
- **No Instagram Graph API**: no Meta developer app needed. Captions queue for manual posting.
- **No YouTube Data API**: titles/descriptions queue for YouTube Studio.
- `DRY_RUN=true` is the safe default — flip to `false` only when Telegram is wired and you've tested the queue.

---

## License

MIT
