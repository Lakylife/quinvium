// Community gatekeeper: people who open the invite link of the private "Quinvium Community" group send a join
// request; the bot sends them the rules in a private message with a button and approves the request once they press it.
// Enabled only when COMMUNITY_CHAT_ID is set. Private messages here never count against the channel limits in events.js.
// Logs carry the user ID and Telegram's error description, never message texts or the token.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** The rules shown before joining. Plain text (no parse_mode), so no character needs escaping. */
export const COMMUNITY_RULES = `👋 Welcome to the Quinvium Community

Quinvium (QU) is a decentralized proof-of-work network. There is no company, no owner, no premine and no admin key.

📜 Rules
1. Be respectful. No harassment, hate or personal attacks.
2. No spam, shilling of other projects, referral links or ads.
3. No price predictions or financial advice.
4. Keep each topic on-topic.
5. Never share your seed phrase or private key. Admins never DM you first and never ask for funds.
6. Report security vulnerabilities privately: https://github.com/Lakylife/quinvium/security
7. Consensus changes happen only through public QIPs.
8. English in the main topics please.

Press the button below to confirm you agree and join.`;

export const AGREE_BUTTON = '✅ I have read and agree to the rules';
export const WELCOME = 'Welcome to the Quinvium Community! You are in. Start with 📌 Rules & Links and 💬 General chat.';
export const INTRO = `Hi, I am the Quinvium bot. I post network news to the channel @Quinvium and let people into the Quinvium Community group.

To join the group, open the invite link from the channel @Quinvium or from quinvium.com and send a join request. I will then send you the rules here.`;
export const EXPIRED = 'This join request is no longer pending. Open the invite link from @Quinvium or quinvium.com again.';
export const ALREADY = 'You are already a member of the Quinvium Community.';

/** Repeated button presses or /start from the same user within this window are ignored. */
export const REPEAT_MS = 5000;
const CALLBACK_PREFIX = 'agree:';
export const ALLOWED_UPDATES = ['message', 'callback_query', 'chat_join_request'];

/** Thrown for a Bot API error; carries the HTTP status and Telegram's description, never the URL with the token. */
export class TelegramError extends Error {
  constructor(method, status, description) {
    super(`${method} ${status}: ${description ?? 'error'}`);
    this.method = method; this.status = status; this.description = description ?? '';
  }
}

/** A minimal Bot API client. */
export function botApi({ token, fetch: f = fetch }) {
  return async function call(method, params = {}, { timeoutMs = 15000 } = {}) {
    const r = await f(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new TelegramError(method, r.status, j.description);
    return j.result;
  };
}

/**
 * @param {{ call: (method: string, params?: object, opts?: object) => Promise<any>, chatId: string|number,
 *           stateFile?: string|null, log?: Function, now?: () => number }} opts
 */
export function gatekeeper({ call, chatId, stateFile = null, log = console.log, now = Date.now }) {
  const community = String(chatId);
  const lastSeen = new Map();   // user ID -> last handled callback or /start (ms)
  const pending = new Set();    // users we sent the rules to since this process started
  let offset = 0;
  if (stateFile) { try { offset = Number(JSON.parse(readFileSync(stateFile, 'utf8')).offset) || 0; } catch { /* first run */ } }

  function saveOffset() {
    if (!stateFile) return;
    writeFileSync(`${stateFile}.tmp`, JSON.stringify({ offset }));
    renameSync(`${stateFile}.tmp`, stateFile);
  }

  /** True when this user was handled a moment ago; the map is pruned so it cannot grow without bound. */
  function repeated(user) {
    const t = now();
    const last = lastSeen.get(user);
    if (last !== undefined && t - last < REPEAT_MS) return true;
    lastSeen.set(user, t);
    if (lastSeen.size > 5000) for (const [u, at] of lastSeen) if (t - at >= REPEAT_MS) lastSeen.delete(u);
    return false;
  }

  async function sendRules(dmChat, user) {
    await call('sendMessage', {
      chat_id: dmChat, text: COMMUNITY_RULES, link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: AGREE_BUTTON, callback_data: `${CALLBACK_PREFIX}${community}` }]] },
    });
    pending.add(user);
  }

  async function onJoinRequest(req) {
    if (String(req.chat?.id) !== community) return;   // only our group
    const user = req.from?.id;
    if (!user) return;
    // user_chat_id may be messaged for 5 minutes after the request even if the person never started the bot.
    try { await sendRules(req.user_chat_id ?? user, user); log(`gatekeeper: rules sent to user ${user}`); }
    catch (e) { log(`gatekeeper: could not send the rules to user ${user}: ${e.description || e.message}`); }
  }

  async function onCallback(cq) {
    const user = cq.from?.id;
    if (!user || typeof cq.data !== 'string' || !cq.data.startsWith(CALLBACK_PREFIX)) return;
    if (cq.data.slice(CALLBACK_PREFIX.length) !== community) {
      await call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      return;
    }
    if (repeated(user)) { await call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {}); return; }
    try {
      await call('approveChatJoinRequest', { chat_id: chatId, user_id: user });
    } catch (e) {
      const already = /USER_ALREADY_PARTICIPANT/i.test(e.description ?? '');
      log(`gatekeeper: approve failed for user ${user}: ${e.description || e.message}`);
      pending.delete(user);
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: already ? ALREADY : EXPIRED, show_alert: true }).catch(() => {});
      return;
    }
    pending.delete(user);
    log(`gatekeeper: approved user ${user}`);
    await call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Welcome!' }).catch(() => {});
    if (cq.message) {
      await call('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: WELCOME })
        .catch((e) => log(`gatekeeper: could not edit the message for user ${user}: ${e.description || e.message}`));
    }
  }

  async function onMessage(msg) {
    if (msg.chat?.type !== 'private' || typeof msg.text !== 'string') return;
    if (!/^\/start(@\w+)?(\s|$)/.test(msg.text)) return;
    const user = msg.from?.id;
    if (!user || repeated(user)) return;
    try {
      if (pending.has(user)) await sendRules(msg.chat.id, user);   // lost the message: send the button again
      else await call('sendMessage', { chat_id: msg.chat.id, text: INTRO, link_preview_options: { is_disabled: true } });
    } catch (e) { log(`gatekeeper: could not answer /start from user ${user}: ${e.description || e.message}`); }
  }

  async function handle(update) {
    if (update.chat_join_request) return onJoinRequest(update.chat_join_request);
    if (update.callback_query) return onCallback(update.callback_query);
    if (update.message) return onMessage(update.message);
  }

  /** One long poll. The offset is saved after every update, so a restart never handles one twice. */
  async function pollOnce(timeout = 50) {
    const updates = await call('getUpdates', { offset, timeout, allowed_updates: ALLOWED_UPDATES }, { timeoutMs: (timeout + 15) * 1000 });
    for (const u of updates) {
      try { await handle(u); } catch (e) { log(`gatekeeper: update ${u.update_id} failed: ${e.message}`); }
      offset = u.update_id + 1;
      saveOffset();
    }
    return updates.length;
  }

  /** Runs until stop() is called. Never touches a webhook: if one is set, it says so and does not poll. */
  let stopped = false;
  async function run({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    try {
      const info = await call('getWebhookInfo');
      if (info?.url) { log('gatekeeper: the bot has a webhook set, so join requests cannot be polled; gatekeeper is off (the webhook was left as it is)'); return 'webhook'; }
    } catch (e) { log(`gatekeeper: getWebhookInfo failed: ${e.description || e.message}`); }
    log(`gatekeeper: on for chat ${community}`);
    while (!stopped) {
      try { await pollOnce(); } catch (e) {
        // 409: another getUpdates is running (a second copy of the announcer) or a webhook was set meanwhile.
        log(`gatekeeper: getUpdates failed, retrying: ${e.description || e.message}`);
        await sleep(e.status === 409 ? 30000 : 5000);
      }
    }
    return 'stopped';
  }

  return { handle, pollOnce, run, stop: () => { stopped = true; }, get offset() { return offset; } };
}

/**
 * Builds the gatekeeper from the environment, or returns null (and the announcer behaves as before) when
 * COMMUNITY_CHAT_ID is unset, or when there is no bot token / this is a dry run.
 */
export function fromEnv(env, { dry = false, stateFile = null, log = console.log, fetch: f = fetch } = {}) {
  const chatId = env.COMMUNITY_CHAT_ID?.trim();
  if (!chatId) return null;
  if (dry || !env.TELEGRAM_BOT_TOKEN) { log('gatekeeper: COMMUNITY_CHAT_ID is set but there is no TELEGRAM_BOT_TOKEN (or this is a dry run), so it stays off'); return null; }
  return gatekeeper({ call: botApi({ token: env.TELEGRAM_BOT_TOKEN, fetch: f }), chatId, stateFile, log });
}
