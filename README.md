# Social Ops

Five [elizaOS](https://docs.elizaos.ai/) agents for Twitter, Instagram, Telegram/WhatsApp support, YouTube, and blog — **without applying for X/Meta/YouTube developer APIs**.

Nothing outbound ships until a human confirms it. Agents also rest (quiet hours, caps, pause) and report health.

## Agents

| Agent | Job | Live network? |
| --- | --- | --- |
| Twitter Guy | Draft tweets, replies, follow-back *review lists* | No. Queue only. |
| Instagram Guy | Vertical clips + captions | No. Queue only. ffmpeg from `media/source/`. |
| TG Guy | Support + approval desk + `/status` | Telegram BotFather token. Optional WhatsApp QR. |
| YouTube Guy | Titles, descriptions, chapters, Shorts packs | No. Queue, then YouTube Studio. |
| Blog Guy | Markdown posts and site copy | No. Queue, then copy into your site. |

## Human in the loop

Talk to **TG Guy** in Telegram or the local UI (`http://localhost:3000`):

```
/pending [platform]
/approve <id>
/edit <id> notes
/reject <id> reason
/published <id>
/feedback <id> notes
/status [agent]
/pause twitter-guy
/resume twitter-guy
/help
```

Approve means “I will post this in the native app”, not “the bot posted it”. After you post, `/published <id>`. Reject/edit notes land in `knowledge/feedback/`.

Support FAQ answers may send immediately (logged). Billing, refunds, legal, and angry customers escalate and wait for you. Set `SUPPORT_AUTO_FAQ=false` to make every support reply pending.

## Resting

Per-agent quiet hours, rest days, daily draft caps, and cooldowns are enforced in code (`src/lib/rest.ts`). `/pause` stops drafting immediately.

## Monitoring

- Telegram `/status`
- `GET /ops/status` and `ops/status.json`
- Alerts for errors, daily cap, and stale unreviewed drafts

## Getting Started

Needs Node 23.3+ and [Bun](https://bun.sh).

```bash
cd social-ops
# Model: local Ollama (free) or set OPENAI_API_KEY
# Optional live support: TELEGRAM_BOT_TOKEN from @BotFather

bun install
bun run build
elizaos start
# or: elizaos dev
```

Open `http://localhost:3000`. Chat with an agent and say “draft a tweet about the changelog”, then `/pending` and `/approve`.

### Environment

Copy `.env.example` values into `.env`:

- `OLLAMA_API_ENDPOINT` / `OPENAI_API_KEY` — at least one model provider
- `TELEGRAM_BOT_TOKEN` — BotFather, not a developer application
- `HITL_CHAT_IDS` — your Telegram chat id (empty = allow local UI)
- `QUIET_HOURS`, `REST_TZ`, `REST_DAYS`, `DAILY_DRAFT_CAP`
- `WHATSAPP_ENABLED=true` plus `bun add @whiskeysockets/baileys` for QR support
- `DRY_RUN=true` (default)

Official `@elizaos/plugin-twitter` is **not** wired. Cookie/password Twitter login is out of scope.

## Development

```bash
elizaos dev
# or
elizaos start
bun run build   # required after edits if you used start
```

## Testing

```bash
bun test src/__tests__/queue.test.ts src/__tests__/hitl-rest.test.ts src/__tests__/social-ops.test.ts
bun test          # full starter + social-ops suite
elizaos test
```

1. **Component tests** (`src/__tests__/*.test.ts`) — Bun
2. **E2E tests** (`src/__tests__/e2e/*.e2e.ts`) — ElizaOS runtime

## Layout

- `src/characters/` — five agent personalities
- `src/plugins/content-queue.ts` — pending → approved → published
- `src/plugins/ops.ts` — rest, pause, `/status`
- `src/plugins/video-clips.ts` — ffmpeg shorts
- `src/plugins/whatsapp.ts` — optional Baileys QR
- `knowledge/` — brand, FAQ, topics, feedback
- `content-queue/` — draft files
- `media/source/` — drop long-form video here
