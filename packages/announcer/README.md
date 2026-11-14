# Quinvium announcer

Posts important mainnet events to the official channels [t.me/Quinvium](https://t.me/Quinvium) and [x.com/Quinvium](https://x.com/Quinvium). It reads only the public JSON-RPC and has no access to any wallet.

| Event | Telegram | X |
| --- | --- | --- |
| Daily summary once a day after 12:00 UTC: blocks, mined QU, hashrate, active miners, transactions | yes | yes |
| Height milestones: 10k, 25k, 50k, 100k, 250k, 500k, 750k, 1M, then every million | yes | yes |
| Hashrate record: at least 20 % above the previous one, at most once a week | yes | yes |
| Halving: 30, 7 and 1 day before, and when it happens | yes | yes |
| New release on GitHub | yes | yes |
| No new block for 10 minutes, and when blocks resume | yes | no |
| New mining pool | yes | no |

## No spam

- Every event is posted once. The state file remembers what was sent; the first run only records the current situation and announces no history.
- Limits: X at most 2 posts a day and 50 a month (within the X API free tier), Telegram at most 20 messages a day. When the X budget is tight, the more important event wins (halving, release, milestone, record, summary).
- If the RPC is unreachable the announcer stays silent and does not catch up later. A failed post is retried; an outage warning expires after 30 minutes.

## Running

```bash
node packages/announcer/src/main.js --once --dry-run   # print what would be posted now
node packages/announcer/src/main.js                     # run every 60 s
```

Settings come from environment variables: `QUINVIUM_RPC` (default `https://rpc.quinvium.com`), `ANNOUNCER_STATE` (state file), `ANNOUNCER_INTERVAL` (seconds) and the keys in [`announcer.env.example`](announcer.env.example). On a server use [`ops/systemd/quinvium-announcer.service`](../../ops/systemd/quinvium-announcer.service).

The keys belong only in `/etc/quinvium/announcer.env` on the server, readable by root only. They are never logged.
