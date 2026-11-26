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

## Community gatekeeper

The same bot can guard the entrance of the private group "Quinvium Community". It is off unless `COMMUNITY_CHAT_ID` is set to the group's Bot API id (for example `-1005888614238`).

1. Someone opens the group's invite link and sends a join request.
2. The bot sends them the rules in a private message with the button "✅ I have read and agree to the rules" (the text is `COMMUNITY_RULES` in [`src/gatekeeper.js`](src/gatekeeper.js)).
3. When they press it, the bot approves the join request and replaces the message with a welcome. An expired request or an existing member gets a short answer instead.
4. `/start` in a private chat with the bot explains that joining works through the invite link from [@Quinvium](https://t.me/Quinvium) or quinvium.com.

Setup in Telegram:

- Add the bot to the group as an administrator with only the right **Invite users via link** (that right is what allows approving join requests).
- Edit the group's invite link and turn on **Request admin approval**. Share only that link.

How it runs: a long poll of `getUpdates` (`message`, `callback_query`, `chat_join_request`) beside the announcement loop. The update offset is saved in `gatekeeper.json` next to the state file (or `GATEKEEPER_STATE`), so a restart handles nothing twice. If the bot has a webhook, the gatekeeper says so in the log and stays off; it never deletes or sets a webhook. Its private messages do not count against the channel limits above. Repeated presses or `/start` within 5 seconds are ignored. The log shows user IDs only, never message texts or the token.

## Running

```bash
node packages/announcer/src/main.js --once --dry-run   # print what would be posted now
node packages/announcer/src/main.js                     # run every 60 s
```

Settings come from environment variables: `QUINVIUM_RPC` (default `https://rpc.quinvium.com`), `ANNOUNCER_STATE` (state file), `ANNOUNCER_INTERVAL` (seconds) and the keys in [`announcer.env.example`](announcer.env.example). On a server use [`ops/systemd/quinvium-announcer.service`](../../ops/systemd/quinvium-announcer.service).

The keys belong only in `/etc/quinvium/announcer.env` on the server, readable by root only. They are never logged.
