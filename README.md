# Freshdesk ⇄ PagerDuty Integration

Polls Freshdesk for tickets where **Firstresponses Overdue = Yes**, creates a
PagerDuty incident for each one, then posts the incident details back on the
ticket as a **private note**. Already-handled tickets aren't re-triggered
unless the field flips back to "No" and then to "Yes" again.

## How it works

1. Every `POLL_INTERVAL_MINUTES`, the app fetches tickets updated since the
   last poll (`GET /tickets?updated_since=...`).
2. For each ticket, it checks `custom_fields.cf_firstresponses_overdue === "Yes"`.
3. If met and not already handled, it fires a PagerDuty event
   (`POST /v2/enqueue`) with a `dedup_key` of `freshdesk-ticket-<id>`, so
   PagerDuty won't create duplicate incidents even if polled twice.
4. It briefly polls PagerDuty's REST API to resolve the real incident ID/URL.
5. It adds a private note to the Freshdesk ticket with the incident link,
   status, and timestamp.
6. State (last poll time + which tickets were already processed) is kept in
   `data/state.json` so restarts don't cause duplicate incidents.

## Setup

1. **Freshdesk API key**: Freshdesk → Profile Settings → API Key.
2. **PagerDuty Events API v2 integration key**: in PagerDuty, open the
   Service you want incidents created on → Integrations tab → Add
   Integration → Events API v2 → copy the Integration Key.
3. **PagerDuty REST API token** (only used to look up the incident's URL for
   the note): My Profile → User Settings → API Access Keys.
4. Copy `.env.example` to `.env` and fill in all values.
5. Confirm the custom field name matches your Freshdesk field's **key** (not
   its label) — for "Firstresponses Overdue" this is typically
   `cf_firstresponses_overdue`. You can verify it via
   `GET /api/v2/ticket_fields` in Freshdesk.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in your values
npm start
```

The app exposes `GET /health` for uptime checks and starts polling
immediately, then on the configured interval.

## Deploying

This is a small long-running Node process — it needs to keep running (not a
one-off serverless function) so the cron schedule and `data/state.json` stay
alive. It runs as-is on any host that keeps a Node process running long-term
(a small VM, Docker container, Render/Railway/Fly.io background worker,
etc.). If you deploy on a platform with an ephemeral filesystem, swap
`stateStore.js` for a small database or a Redis key so state survives
restarts/redeploys.

## Notes & limitations

- **Polling vs. webhooks**: this polls on a timer rather than reacting
  instantly to Freshdesk automation webhooks. Lower `POLL_INTERVAL_MINUTES`
  for faster reaction time, balanced against Freshdesk API rate limits.
- **Rate limits**: Freshdesk and PagerDuty both rate-limit their APIs. If you
  have a very high ticket volume, consider narrowing the Freshdesk query
  (e.g. by adding a saved-search/company filter) instead of scanning every
  updated ticket.
- **Severity/summary customization**: adjust `PAGERDUTY_SEVERITY` in `.env`,
  or edit `handleTriggeredTicket` in `src/poller.js` to change what's sent to
  PagerDuty or written in the note.
- **Multiple conditions**: to trigger on more than one field/value
  combination, extend the `conditionMet` check in `src/poller.js`.
