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

### Posts in the group's topics

With `COMMUNITY_CHAT_ID` set, every Telegram post goes to the group instead of the channel, each into its topic. The channel [@Quinvium](https://t.me/Quinvium) then gets nothing from the bot (its pinned join post is kept by hand); `TELEGRAM_ANNOUNCE_TO=channel` switches back. X is unchanged. The limits stay: at most 5 messages an hour and 20 a day, urgent warnings first, small events in a digest every 6 hours.

| Topic key | Topic in the group | What the bot posts there |
| --- | --- | --- |
| `announcements` | 📢 ANNOUNCEMENTS | Releases, halvings, height milestones, hashrate records, the daily summary, block outage and recovery, deep reorganisation, changed website or Explorer files |
| `nodes` | 🖥️ Nodes & RPC | A node on another branch and the all-clear, node count milestones (5, 10, 25, 50, 100, 250, 500, 1000 verified nodes) |
| `mining` | 📡 Mining feed | New miners, new pools, hashrate swings, a miner with over half of the work, the weekly new-miner count, the 6-hour digest |
| `general` | 💬 GENERAL CHAT | Only the welcome for new members |

The bot never posts in 📌 RULES & LINKS. To link a topic, an admin writes `/topic announcements` (or `nodes`, `mining`, `general`) inside that topic; `/topic` alone lists the links. Until a key is linked its posts go to the group's General chat. The links are kept in `gatekeeper.json`; `COMMUNITY_TOPICS=announcements=2,mining=4` can set them by hand.

New members: after the bot approves someone, it welcomes them in 💬 GENERAL CHAT by @username (or first name). Everyone approved within 10 minutes shares one welcome message. The bot deletes Telegram's "X joined the group" messages.

Rights in the group: **Invite users via link** (approving), **Delete messages** (the "joined" messages), **Pin messages** and **Manage topics**. 📢 ANNOUNCEMENTS is a closed topic; without "Manage topics" Telegram refuses the post with `TOPIC_CLOSED`, which the log names.

### Community assistant (AI answers)

With `ANTHROPIC_API_KEY` set, the bot answers questions with Claude Haiku 5.5 (`claude-haiku-5-5`, effort low):

- **When:** in the group, a message that mentions @quinviumbot or replies to one of its messages; in private, any message from a member of the group (others get the join instructions). Never in the topics linked as `announcements`, `mining` or `rules` (`/topic rules` in 📌 RULES & LINKS), never to bots or `/commands`.
- **Auto-answers** (`ASSISTANT_AUTO=on`, the default; `off` turns them off): in the group it also answers a member's message that nobody addressed to it when the message looks like a question (a `?`, or it starts with what, how, is, can, where, …) **and** is about QU or Quinvium (it names QU, QU coins or Quinvium, or combines a mining, pool, wallet or node word with coin, token or chain). Price, listing or exchange words alone never trigger it. Never for admins, bots, `/commands`, messages that already mention or reply to the bot (they get the normal answer, never two), or in the closed topics linked as `announcements`, `mining`, `welcome` or `rules`. At most one auto-answer attempt per topic a minute. The model may answer `SKIP` when the message is not a real question about Quinvium or is already answered; the bot then stays silent. Auto-answers send no limit or error notices; a skipped request still counts against the daily cap.
- **What it knows:** [`assistant/FAQ.md`](assistant/FAQ.md), condensed from the repository docs, plus live numbers from the announcer's last snapshot (height, hashrate, supply, 24-hour blocks and miners, reward, next halving, latest release). It never calls the RPC per question. Edit the FAQ and restart to change what it knows.
- **Rules in its prompt:** short answers in the asker's language, no price predictions or financial advice, never asks for seed phrases, keys or coins, says when it does not know and points to 🆘 HELP & SUPPORT or GitHub, never claims to be a person or an admin.
- **Cost guards:** the rules and FAQ are a frozen, cached system prompt (about 3,500 tokens, read from the cache at $0.01 per million tokens); no chat history, only the question and the message it replies to, each cut to 1,500 characters; at most 5 answers per user per hour and `ASSISTANT_DAILY_LIMIT` (default 150) a day, kept in `assistant.json` next to the state file. Every answer logs its token counts and estimated USD, and the day's total; never the texts. Set a monthly spend limit in the Anthropic console as well.
- **Estimated cost** (Haiku 5.5: $0.10 per million input tokens, $0.50 output, $0.01 cached reads, $0.125 cache writes): about $0.0003 per answer when the cache is warm, about $0.0007 when it is cold (first answer after 5 quiet minutes); roughly $0.30 to $0.70 per 1,000 answers, so the default cap costs at most about $0.11 a day.
- Its replies do not count against the channel limits above.

The SDK is a dependency of this package only: on the server run `npm ci --omit=dev` in `packages/announcer` once.

How it runs: a long poll of `getUpdates` (`message`, `callback_query`, `chat_join_request`) beside the announcement loop. The update offset is saved in `gatekeeper.json` next to the state file (or `GATEKEEPER_STATE`), so a restart handles nothing twice. If the bot has a webhook, the gatekeeper says so in the log and stays off; it never deletes or sets a webhook. Its private messages do not count against the channel limits above. Repeated presses or `/start` within 5 seconds are ignored. The log shows user IDs only, never message texts or the token.

## Running

```bash
node packages/announcer/src/main.js --once --dry-run   # print what would be posted now
node packages/announcer/src/main.js                     # run every 60 s
```

Settings come from environment variables: `QUINVIUM_RPC` (default `https://rpc.quinvium.com`), `ANNOUNCER_STATE` (state file), `ANNOUNCER_INTERVAL` (seconds) and the keys in [`announcer.env.example`](announcer.env.example). On a server use [`ops/systemd/quinvium-announcer.service`](../../ops/systemd/quinvium-announcer.service).

The keys belong only in `/etc/quinvium/announcer.env` on the server, readable by root only. They are never logged.
