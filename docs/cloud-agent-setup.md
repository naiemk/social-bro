# Cloud Agent setup for social-bro

Use this checklist once, then future Cloud Agent runs should push without manual PAT pasting.

## 1. Connect GitHub in Cursor

1. Open [Cursor Integrations](https://cursor.com/dashboard/integrations)
2. Connect GitHub
3. Grant Cursor app access to `naiemk/social-bro`

## 2. Create a Cloud Environment

1. Open [Cloud Agents → Environments](https://cursor.com/dashboard/cloud-agents#environments)
2. Add repository: `naiemk/social-bro`
3. Let setup/build complete (uses `.cursor/environment.json`)

## 3. Launch agents from the repo

Start Cloud Agents from:

- `cursor.com/agents` with repo selected, or
- Desktop Cloud mode with `social-bro` selected

Do not start blank/no-repo runs for git work.

## 4. Add secrets in dashboard

Add in Cloud Agents → Secrets:

- `TELEGRAM_BOT_TOKEN`
- `REPLICATE_API_TOKEN`
- `OPENAI_API_KEY` (optional)
- `GITHUB_OPERATOR_PAT` (optional; only if you need workflow edits or `gh pr` commands)

Do not name your personal PAT `GH_TOKEN` (Cursor may inject its own token there).

## 5. Push health check

In a repo-linked run:

```bash
gh auth status
git remote -v
git push --dry-run
```

Expected remote:

`https://github.com/naiemk/social-bro.git`

## 6. VPS deploy files

On VPS, copy:

- `deploy/docker-compose.yml`
- `config.yaml`
- `.env`
- `deploy/nginx/*`

Then:

```bash
docker compose pull
docker compose up -d
```
