import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALREADY, AGREE_BUTTON, COMMUNITY_RULES, EXPIRED, INTRO, REPEAT_MS, TelegramError, WELCOME, botApi, fromEnv, gatekeeper } from '../src/gatekeeper.js';
import { allowed, count } from '../src/events.js';

const CHAT = '-1005888614238';
const USER = 777;

/** A mocked Bot API: records every call and answers from `replies` (a function per method). */
function mockApi(replies = {}) {
  const calls = [];
  const call = async (method, params = {}) => {
    calls.push({ method, params });
    const r = replies[method];
    if (typeof r === 'function') return r(params);
    return r ?? true;
  };
  return { call, calls, of: (m) => calls.filter((c) => c.method === m) };
}
const joinRequest = (chat = CHAT, user = USER) => ({ update_id: 1, chat_join_request: { chat: { id: Number(chat), type: 'supergroup' }, from: { id: user }, user_chat_id: user, date: 0 } });
const press = (data = `agree:${CHAT}`, user = USER, id = 'cq1') => ({ update_id: 2, callback_query: { id, from: { id: user }, data, message: { message_id: 55, chat: { id: user, type: 'private' } } } });
const start = (user = USER) => ({ update_id: 3, message: { message_id: 9, chat: { id: user, type: 'private' }, from: { id: user }, text: '/start' } });
const quiet = () => {};

test('a join request for the community gets the rules in a private message with the agree button', async () => {
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet });
  await g.handle(joinRequest());
  const [dm] = api.of('sendMessage');
  assert.equal(dm.params.chat_id, USER);
  assert.equal(dm.params.text, COMMUNITY_RULES);
  assert.equal(dm.params.parse_mode, undefined, 'plain text');
  const [[button]] = dm.params.reply_markup.inline_keyboard;
  assert.equal(button.text, AGREE_BUTTON);
  assert.equal(button.callback_data, `agree:${CHAT}`);
  assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  assert.equal(api.of('approveChatJoinRequest').length, 0, 'nobody is let in before pressing the button');
});

test('pressing the button approves the request, answers the press and edits the message', async () => {
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet });
  await g.handle(joinRequest());
  await g.handle(press());
  assert.deepEqual(api.of('approveChatJoinRequest').map((c) => c.params), [{ chat_id: CHAT, user_id: USER }]);
  assert.equal(api.of('answerCallbackQuery')[0].params.callback_query_id, 'cq1');
  const [edit] = api.of('editMessageText');
  assert.deepEqual(edit.params, { chat_id: USER, message_id: 55, text: WELCOME });
});

test('an expired request or an existing member gets a polite answer and the failure is logged without texts', async () => {
  const lines = [];
  for (const [description, text] of [['Bad Request: HIDE_REQUESTER_MISSING', EXPIRED], ['Bad Request: USER_ALREADY_PARTICIPANT', ALREADY]]) {
    const api = mockApi({ approveChatJoinRequest: () => { throw new TelegramError('approveChatJoinRequest', 400, description); } });
    const g = gatekeeper({ call: api.call, chatId: CHAT, log: (l) => lines.push(l) });
    await g.handle(press());
    const [answer] = api.of('answerCallbackQuery');
    assert.equal(answer.params.text, text);
    assert.equal(api.of('editMessageText').length, 0);
  }
  assert.ok(lines.every((l) => l.includes(`user ${USER}`) && !l.includes('Welcome to the Quinvium')));
});

test('join requests and buttons for other chats are ignored', async () => {
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet });
  await g.handle(joinRequest('-1001234567890'));
  await g.handle(press('agree:-1001234567890'));
  await g.handle(press('something-else'));
  assert.equal(api.of('sendMessage').length, 0);
  assert.equal(api.of('approveChatJoinRequest').length, 0);
});

test('repeated presses and /start within a few seconds are ignored', async () => {
  let t = 1_000_000;
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet, now: () => t });
  await g.handle(press(undefined, USER, 'a'));
  await g.handle(press(undefined, USER, 'b'));
  assert.equal(api.of('approveChatJoinRequest').length, 1);
  t += REPEAT_MS;
  await g.handle(start());
  await g.handle(start());
  assert.equal(api.of('sendMessage').length, 1);
  await g.handle(start(USER + 1));
  assert.equal(api.of('sendMessage').length, 2, 'the limit is per user');
});

test('/start in a private chat: an intro without a pending request, the button again with one; group messages are ignored', async () => {
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet, now: (() => { let t = 0; return () => (t += REPEAT_MS); })() });
  await g.handle(start());
  assert.equal(api.of('sendMessage')[0].params.text, INTRO);
  assert.match(INTRO, /@Quinvium/);
  assert.match(INTRO, /quinvium\.com/);
  await g.handle(joinRequest());
  await g.handle(start());
  assert.equal(api.of('sendMessage')[2].params.text, COMMUNITY_RULES);
  await g.handle({ update_id: 4, message: { chat: { id: Number(CHAT), type: 'supergroup' }, from: { id: USER }, text: '/start' } });
  assert.equal(api.of('sendMessage').length, 3);
});

test('polling asks for join requests, buttons and messages, and keeps the offset across restarts', async () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'gk-')), 'gatekeeper.json');
  const api = mockApi({ getUpdates: (p) => (p.offset <= 41 ? [{ ...joinRequest(), update_id: 40 }, { ...press(), update_id: 41 }] : []) });
  const g = gatekeeper({ call: api.call, chatId: CHAT, stateFile, log: quiet });
  assert.equal(await g.pollOnce(0), 2);
  const [poll] = api.of('getUpdates');
  assert.deepEqual([...poll.params.allowed_updates].sort(), ['callback_query', 'chat_join_request', 'message']);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), { offset: 42 });
  const again = gatekeeper({ call: api.call, chatId: CHAT, stateFile, log: quiet });
  assert.equal(again.offset, 42);
  assert.equal(await again.pollOnce(0), 0, 'nothing is handled twice');
  assert.equal(api.of('approveChatJoinRequest').length, 1);
});

test('a webhook is reported and left alone, never deleted', async () => {
  const lines = [];
  const api = mockApi({ getWebhookInfo: { url: 'https://example.invalid/hook' } });
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: (l) => lines.push(l) });
  assert.equal(await g.run({ sleep: async () => {} }), 'webhook');
  assert.deepEqual(api.calls.map((c) => c.method), ['getWebhookInfo']);
  assert.match(lines.join('\n'), /webhook/);
});

test('the Bot API client never puts the token into an error', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) });
  const call = botApi({ token: '123:SECRET', fetch: fakeFetch });
  await assert.rejects(call('getMe'), (e) => e instanceof TelegramError && !e.message.includes('SECRET') && e.status === 401);
});

test('without COMMUNITY_CHAT_ID (or without a token, or in a dry run) the gatekeeper is off and calls nothing', async () => {
  let fetched = 0;
  const f = async () => { fetched += 1; throw new Error('no network in tests'); };
  assert.equal(fromEnv({ TELEGRAM_BOT_TOKEN: '1:x' }, { fetch: f, log: quiet }), null);
  assert.equal(fromEnv({ TELEGRAM_BOT_TOKEN: '1:x', COMMUNITY_CHAT_ID: '  ' }, { fetch: f, log: quiet }), null);
  assert.equal(fromEnv({ COMMUNITY_CHAT_ID: CHAT }, { fetch: f, log: quiet }), null);
  assert.equal(fromEnv({ TELEGRAM_BOT_TOKEN: '1:x', COMMUNITY_CHAT_ID: CHAT }, { dry: true, fetch: f, log: quiet }), null);
  assert.ok(fromEnv({ TELEGRAM_BOT_TOKEN: '1:x', COMMUNITY_CHAT_ID: CHAT }, { fetch: f, log: quiet }));
  assert.equal(fetched, 0);
});

test('the gatekeeper never touches the channel limiter', async () => {
  const state = { counts: {} };
  count(state, 'telegram', 1000);
  const before = JSON.stringify(state);
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet });
  for (let i = 0; i < 30; i++) await g.handle(joinRequest(CHAT, 1000 + i));
  assert.equal(api.of('sendMessage').length, 30);
  assert.equal(JSON.stringify(state), before);
  assert.ok(allowed(state, 'telegram', 1000));
});
