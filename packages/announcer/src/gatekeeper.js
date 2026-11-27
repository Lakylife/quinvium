// Community gatekeeper: people who open the invite link of the private "Quinvium Community" group send a join
// request; the bot sends them the rules in a private message with a button and approves the request once they press it.
// Enabled only when COMMUNITY_CHAT_ID is set. Private messages here never count against the channel limits in events.js.
// Logs carry the user ID and Telegram's error description, never message texts or the token.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { TOPIC_KEYS } from './events.js';
import { trigger as assistantTrigger } from './assistant.js';

/** Topic keys an admin can link: the posting topics plus rules, where the assistant stays quiet. */
export const LINK_KEYS = [...TOPIC_KEYS, 'rules'];

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
export const WELCOME = 'Welcome to the Quinvium Community! You are in. Start with 📌 RULES & LINKS, then say hi in 💬 GENERAL CHAT. Questions go to 🆘 HELP & SUPPORT.';
export const INTRO = `Hi, I am the Quinvium bot. I post network news to the channel @Quinvium and let people into the Quinvium Community group.

To join the group, open the invite link from the channel @Quinvium or from quinvium.com and send a join request. I will then send you the rules here.`;
export const EXPIRED = 'This join request is no longer pending. Open the invite link from @Quinvium or quinvium.com again.';
export const ALREADY = 'You are already a member of the Quinvium Community.';

/** New members approved within this window are welcomed together in one message in General chat. */
export const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const WELCOME_NAMES = 10;   // at most this many names, then "and N others"
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The welcome text for a batch of new members: @username, or the first name as a mention when there is no username. */
export function welcomeText(users) {
  const name = (u) => (u.username ? `@${esc(u.username)}` : `<a href="tg://user?id=${Number(u.id)}">${esc(u.first_name || 'friend')}</a>`);
  const shown = users.slice(0, WELCOME_NAMES).map(name);
  const rest = users.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`
    : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
  return `👋 Welcome to the Quinvium Community, ${list}!\n\nStart with 📌 RULES &amp; LINKS. Questions go to 🆘 HELP &amp; SUPPORT, mining talk to ⛏️ MINING CHAT, and other languages have their own topics (🇨🇿 Czech &amp; Slovak, 🇷🇺 Russian, 🇨🇳 Chinese, 🇯🇵 Japanese, 🇰🇷 Korean, 🌍 Other languages).`;
}

/**
 * The topic links an admin made with /topic, from the gatekeeper's state file, with COMMUNITY_TOPICS
 * ("announcements=12,mining=34") on top. A key without a link (or linked to null) means General chat.
 */
export function readTopics(stateFile, override = '') {
  let topics = {};
  if (stateFile) { try { topics = JSON.parse(readFileSync(stateFile, 'utf8')).topics ?? {}; } catch { /* none yet */ } }
  for (const part of String(override).split(',')) {
    const m = /^\s*(\w+)\s*=\s*(\d+)\s*$/.exec(part);
    if (m && TOPIC_KEYS.includes(m[1])) topics[m[1]] = Number(m[2]);
  }
  return topics;
}

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
export function gatekeeper({ call, chatId, stateFile = null, log = console.log, now = Date.now, assistant = null, me = null }) {
  const members = new Map();   // user ID -> {ok, at}: group membership for private questions, cached 10 minutes
  const community = String(chatId);
  const lastSeen = new Map();   // user ID -> last handled callback or /start (ms)
  const pending = new Set();    // users we sent the rules to since this process started
  let offset = 0;
  let topics = {};                      // topic key -> message_thread_id (null: General chat)
  let welcome = { since: null, users: [] };
  if (stateFile) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      offset = Number(saved.offset) || 0;
      topics = saved.topics ?? {};
      if (Array.isArray(saved.welcome?.users)) welcome = saved.welcome;
    } catch { /* first run */ }
  }

  /** Offset, topic links and the waiting welcome, written atomically; the announcer reads the topic links from here. */
  function saveOffset() {
    if (!stateFile) return;
    writeFileSync(`${stateFile}.tmp`, JSON.stringify({ offset, topics, welcome }));
    renameSync(`${stateFile}.tmp`, stateFile);
  }
  const thread = (key) => (topics[key] ? { message_thread_id: topics[key] } : {});

  function queueWelcome(from) {
    if (!from?.id || welcome.users.some((u) => u.id === from.id)) return;
    welcome.since ??= now();
    welcome.users.push({ id: from.id, username: from.username ?? null, first_name: from.first_name ?? null });
    saveOffset();
  }

  /** Sends the waiting welcome once the window is over. A failure is retried on the next poll, for at most an hour. */
  async function flushWelcome() {
    if (!welcome.users.length || now() - welcome.since < WELCOME_WINDOW_MS) return false;
    try {
      await call('sendMessage', { chat_id: chatId, ...thread('general'), text: welcomeText(welcome.users), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      log(`gatekeeper: welcomed ${welcome.users.length} new member(s)`);
    } catch (e) {
      log(`gatekeeper: welcome failed: ${e.description || e.message}`);
      if (now() - welcome.since < WELCOME_WINDOW_MS + 3600_000) return false;
    }
    welcome = { since: null, users: [] };
    saveOffset();
    return true;
  }

  async function isAdmin(msg) {
    if (msg.sender_chat && String(msg.sender_chat.id) === community) return true;   // an anonymous admin writes as the group
    if (!msg.from?.id) return false;
    try { return ['creator', 'administrator'].includes((await call('getChatMember', { chat_id: chatId, user_id: msg.from.id }))?.status); }
    catch { return false; }
  }

  /** In the community group: delete "X joined" service messages, and let an admin link a topic with /topic <key>. */
  async function onGroupMessage(msg) {
    if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
      await call('deleteMessage', { chat_id: chatId, message_id: msg.message_id })
        .catch((e) => log(`gatekeeper: could not delete a join message (the bot needs the "Delete messages" right): ${e.description || e.message}`));
      return;
    }
    const m = typeof msg.text === 'string' ? /^\/topic(?:@\w+)?(?:\s+(\w+))?\s*$/i.exec(msg.text) : null;
    if (!m) return askAssistant(msg);
    if (!(await isAdmin(msg))) return;
    const here = msg.is_topic_message ? msg.message_thread_id : null;
    const key = m[1]?.toLowerCase();
    let text;
    if (key && LINK_KEYS.includes(key)) {
      topics[key] = here;
      saveOffset();
      log(`gatekeeper: topic ${key} linked to ${here ?? 'General chat'} by user ${msg.from?.id ?? 'anonymous admin'}`);
      text = `✅ This topic now gets the bot's ${key} posts.`;
    } else {
      const links = LINK_KEYS.map((k) => `${k}: ${topics[k] ? `topic ${topics[k]}` : k === 'rules' ? 'not linked' : 'General chat'}`).join('\n');
      text = `Use /topic <key> inside a topic. Keys: ${LINK_KEYS.join(', ')}.\n\n${links}`;
    }
    await call('sendMessage', { chat_id: chatId, ...(here ? { message_thread_id: here } : {}), text, reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } })
      .catch((e) => log(`gatekeeper: could not answer /topic: ${e.description || e.message}`));
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
    queueWelcome(cq.from);
    await call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Welcome!' }).catch(() => {});
    if (cq.message) {
      await call('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: WELCOME })
        .catch((e) => log(`gatekeeper: could not edit the message for user ${user}: ${e.description || e.message}`));
    }
  }

  async function isMember(user) {
    const hit = members.get(user);
    if (hit && now() - hit.at < 600_000) return hit.ok;
    let ok = false;
    try {
      const m = await call('getChatMember', { chat_id: chatId, user_id: user });
      ok = ['creator', 'administrator', 'member'].includes(m?.status) || (m?.status === 'restricted' && m.is_member === true);
    } catch { ok = false; }
    members.set(user, { ok, at: now() });
    if (members.size > 5000) members.clear();
    return ok;
  }

  /** A question for the assistant: a mention or a reply to the bot in the group, or a private message from a member. */
  async function askAssistant(msg) {
    if (!assistant || !me) return;
    const q = assistantTrigger(msg, { me, community, topics });
    if (!q) return;
    const user = msg.from?.id;
    if (!user) return;
    if (q.where === 'private' && !(await isMember(user))) {
      if (!repeated(user)) await call('sendMessage', { chat_id: msg.chat.id, text: INTRO, link_preview_options: { is_disabled: true } }).catch(() => {});
      return;
    }
    const text = await assistant.answer(user, q);
    if (!text) return;
    await call('sendMessage', {
      chat_id: msg.chat.id, ...(msg.is_topic_message && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
      text, link_preview_options: { is_disabled: true }, reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    }).catch((e) => log(`assistant: could not send the answer to user ${user}: ${e.description || e.message}`));
  }

  async function onMessage(msg) {
    if (String(msg.chat?.id) === community) return onGroupMessage(msg);
    if (msg.chat?.type !== 'private' || typeof msg.text !== 'string') return;
    if (!/^\/start(@\w+)?(\s|$)/.test(msg.text)) return askAssistant(msg);
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
    await flushWelcome();
    return updates.length;
  }

  /** Runs until stop() is called. Never touches a webhook: if one is set, it says so and does not poll. */
  let stopped = false;
  async function run({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    try {
      const info = await call('getWebhookInfo');
      if (info?.url) { log('gatekeeper: the bot has a webhook set, so join requests cannot be polled; gatekeeper is off (the webhook was left as it is)'); return 'webhook'; }
    } catch (e) { log(`gatekeeper: getWebhookInfo failed: ${e.description || e.message}`); }
    if (assistant && !me) {
      try { me = await call('getMe'); } catch (e) { log(`gatekeeper: getMe failed, the assistant stays off: ${e.description || e.message}`); }
    }
    log(`gatekeeper: on for chat ${community}${assistant && me ? `, assistant on as @${me.username}` : ''}`);
    while (!stopped) {
      try { await pollOnce(); } catch (e) {
        // 409: another getUpdates is running (a second copy of the announcer) or a webhook was set meanwhile.
        log(`gatekeeper: getUpdates failed, retrying: ${e.description || e.message}`);
        await sleep(e.status === 409 ? 30000 : 5000);
      }
    }
    return 'stopped';
  }

  return { handle, pollOnce, flushWelcome, run, stop: () => { stopped = true; }, get offset() { return offset; }, get topics() { return { ...topics }; }, get welcome() { return welcome; } };
}

/**
 * Builds the gatekeeper from the environment, or returns null (and the announcer behaves as before) when
 * COMMUNITY_CHAT_ID is unset, or when there is no bot token / this is a dry run.
 */
export function fromEnv(env, { dry = false, stateFile = null, log = console.log, fetch: f = fetch, assistant = null } = {}) {
  const chatId = env.COMMUNITY_CHAT_ID?.trim();
  if (!chatId) return null;
  if (dry || !env.TELEGRAM_BOT_TOKEN) { log('gatekeeper: COMMUNITY_CHAT_ID is set but there is no TELEGRAM_BOT_TOKEN (or this is a dry run), so it stays off'); return null; }
  return gatekeeper({ call: botApi({ token: env.TELEGRAM_BOT_TOKEN, fetch: f }), chatId, stateFile, log, assistant });
}
