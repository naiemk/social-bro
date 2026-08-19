# Trustless Commerce Marketing Workspace

This folder is the working draft for running full marketing and customer support for `trustless-commerce.com` with the `social-bro` system.

## Defaults used

These are the defaults I used so we can move immediately:

- Scope: social media marketing, SEO/content, and customer support
- Channels:
  - X/Twitter drafts and replies
  - Instagram short-form clips and captions
  - YouTube Shorts packages and metadata
  - Blog/SEO articles and landing-page copy
  - Telegram support desk
- Operating model:
  - Human-in-the-loop for posts and high-risk support
  - Auto-approve only for low-risk comments and FAQ responses
  - AI video generation through Replicate-first workflow
- Contract type:
  - Agency services agreement + statement of work

## Files in this folder

- [go-to-market-plan.md](./go-to-market-plan.md) — channel strategy, operating model, deliverables, KPIs, and launch phases
- [contract-draft.md](./contract-draft.md) — first-pass agency agreement + statement of work

## What I still need from you

To finalize the operating setup and contract terms, I still need:

1. Legal names
   - Client legal entity name
   - Provider legal entity name
   - Notice email and business address for both sides

2. Commercial terms
   - Monthly retainer or project fee
   - Contract start date
   - Initial term length
   - Payment terms
   - Approval turnaround expectation

3. Brand and support rules
   - Final brand voice
   - Prohibited claims
   - Refund/billing policy
   - Support escalation path
   - Target response times

4. Access and tools
   - Telegram bot token
   - Replicate API token
   - VPS domain/TLS plan
   - Any analytics/search-console/ad accounts you want included later

## Suggested next working sequence

1. Finalize scope and deliverables in `go-to-market-plan.md`
2. Fill party names and commercial terms in `contract-draft.md`
3. Convert support policy into production FAQ/brand docs
4. Decide content calendar, keyword cluster, and response SLA
5. Deploy the VPS stack with `config.yaml`, `.env`, and docker compose
