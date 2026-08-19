# social-bro deploy

This stack runs `social-bro` behind nginx and auto-updates containers every 15 minutes using Watchtower.

## Files you need on VPS

- `docker-compose.yml`
- `config.yaml`
- `.env` (your secrets only)
- optional `deploy/.env.example` values copied to `.env` in deploy folder
- optional TLS cert/key paths if not using the default self-signed cert

## Quick start

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

mkdir -p social-bro
cd social-bro
# copy docker-compose.yml, config.yaml, .env, and nginx folder here
cp .env.example .env

docker compose pull
docker compose up -d
```

## Auto-updates

- Watchtower checks every `WATCHTOWER_POLL_SECONDS` (default `900` = 15m).
- It pulls newer image tags and performs rolling restarts.

## TLS

Set these environment variables if certs live outside the project directory:

- `TLS_FULLCHAIN=/etc/letsencrypt/live/<domain>/fullchain.pem`
- `TLS_PRIVKEY=/etc/letsencrypt/live/<domain>/privkey.pem`
- `CERTBOT_WWW=/var/www/certbot`
