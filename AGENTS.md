# Cursor Cloud instructions

## Repository

- GitHub: `https://github.com/naiemk/social-bro`
- Main deploy docs: `deploy/README.md`
- Marketing workspace: `marketing/trustless-commerce/`

## Startup

1. Read `config.yaml` for non-secret runtime settings.
2. Secrets live in `.env` (never commit).
3. Start with `elizaos start` (port 3000 behind nginx in production).

## Git push (Cloud Agent)

- Push from an agent run linked to this repo when possible.
- If manual terminal push fails, ask the agent to push or run `gh auth setup-git`.
- Workflow file updates require a token with `workflow` scope.

## Required secrets (dashboard)

- `TELEGRAM_BOT_TOKEN`
- `REPLICATE_API_TOKEN`
- one model provider key (`OPENAI_API_KEY` and/or Ollama endpoint)

## Tests

```bash
bun test src/__tests__/queue.test.ts src/__tests__/hitl-rest.test.ts src/__tests__/sensitivity.test.ts src/__tests__/config-yaml.test.ts src/__tests__/social-ops.test.ts
```
