// The community group: every event goes to its topic, the channel stays silent, admins link topics, new members are welcomed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_COUNTS, PRIORITY, TOPIC, TOPIC_KEYS, detect, initialState } from '../src/events.js';
import { telegramMessage } from '../src/format.js';
import { telegram } from '../src/channels.js';
import { WELCOME_WINDOW_MS, gatekeeper, readTopics, welcomeText } from '../src/gatekeeper.js';

const CHAT = '-1005888614238';
const quiet = () => {};
const dir = mkdtempSync(join(tmpdir(), 'topics-'));
const GATE = join(dir, 'gatekeeper.json');
// main.js reads its configuration when it is loaded, so the environment is set first (node --test runs each file alone).
Object.assign(process.env, { COMMUNITY_CHAT_ID: CHAT, GATEKEEPER_STATE: GATE, ANNOUNCER_STATE: join(dir, 'state.json'), TELEGRAM_CHAT: '@Quinvium' });
delete process.env.TELEGRAM_ANNOUNCE_TO;
const { telegramFor, TELEGRAM_TARGET } = await import('../src/main.js');

function mockApi(replies = {}) {
  const calls = [];
  const call = async (method, params = {}) => { calls.push({ method, params }); const r = replies[method]; return typeof r === 'function' ? r(params) : r ?? true; };
  return { call, calls, of: (m) => calls.filter((c) => c.method === m) };
}
const groupMsg = (o) => ({ update_id: 9, message: { message_id: 70, chat: { id: Number(CHAT), type: 'supergroup', is_forum: true }, from: { id: 5 }, ...o } });

test('every event kind has a topic among the known keys, and the routing follows the agreed topics', () => {
  for (const kind of Object.keys(PRIORITY)) assert.ok(TOPIC_KEYS.includes(TOPIC[kind]), `${kind} has a topic`);
  assert.ok(!Object.values(TOPIC).includes('rules'), 'nothing goes to Rules & Links');
  for (const k of ['release', 'halving', 'halving-soon', 'milestone', 'hashrate', 'summary', 'stall', 'resume', 'watch-reorg', 'watch-site', 'watch-site-ok']) assert.equal(TOPIC[k], 'announcements', k);
  for (const k of ['watch-chain', 'watch-chain-ok', 'watch-fork-refused', 'node-count']) assert.equal(TOPIC[k], 'nodes', k);
  for (const k of ['miner', 'pool', 'hashrate-jump', 'majority', 'majority-end', 'digest']) assert.equal(TOPIC[k], 'mining', k);
});

test('posts go to the community group in their topic; an unlinked topic means General chat', () => {
  assert.equal(TELEGRAM_TARGET, CHAT, 'the channel @Quinvium gets nothing');
  writeFileSync(GATE, JSON.stringify({ offset: 1, topics: { announcements: 11, nodes: 22 } }));
  const milestone = { kind: 'milestone', data: { height: 10_000 } };
  assert.equal(telegramFor(milestone).thread, 11);
  assert.equal(telegramFor({ kind: 'watch-chain-ok', data: { checked: 3 } }).thread, 22);
  assert.equal(telegramFor({ kind: 'miner', data: { address: '0x' + '12'.repeat(20), block: 5 } }).thread, undefined, 'mining is not linked yet');
  assert.equal(telegramFor(milestone).text, telegramMessage(milestone).text);
  process.env.COMMUNITY_TOPICS = 'mining=33, bogus=4';
  assert.equal(telegramFor({ kind: 'pool', data: { address: '0xabc', name: 'P' } }).thread, 33, 'COMMUNITY_TOPICS adds links');
  delete process.env.COMMUNITY_TOPICS;
});

test('node count milestones: once each, none from history, none after an upgrade from an older state', () => {
  const nodes = (k) => Array.from({ length: k }, (_, i) => ({ id: i.toString(16).padStart(32, '0') }));
  const base = { height: 2_400, headTime: 1000, hashrate: 1, reward: '4000000000000000000', halvingInterval: 8_000_000, blockTime: 15, supply: '0', day: null, release: null, pools: [] };
  const s = initialState({ ...base, nodes: nodes(7) }, 1000);
  const r = detect(s, { ...base, headTime: 1050, nodes: nodes(11) }, 1060);
  assert.deepEqual(r.events.filter((e) => e.kind === 'node-count').map((e) => e.key), ['nodes:10']);
  assert.match(telegramMessage(r.events.find((e) => e.kind === 'node-count')).text, /10 nodes on the network/);
  const old = { ...s }; delete old.nodeCountsKnown;
  const u = detect(old, { ...base, headTime: 1050, nodes: nodes(30) }, 1060);
  assert.deepEqual(u.events.filter((e) => e.kind === 'node-count'), []);
  assert.ok(NODE_COUNTS.includes(25) && u.state.sent['nodes:25']);
});

test('the Telegram channel sends to a topic, explains a closed topic and falls back when a topic is gone', async () => {
  const sent = [];
  let reply = { ok: true };
  const f = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); const r = typeof reply === 'function' ? reply(body) : reply; return { ok: r.ok, status: r.ok ? 200 : 400, json: async () => r }; };
  const tg = telegram({ token: '1:x', chat: CHAT, fetch: f, log: quiet });
  await tg.send({ text: 'hi', thread: 11 });
  assert.equal(sent[0].message_thread_id, 11);
  await tg.send({ text: 'hi' });
  assert.equal('message_thread_id' in sent[1], false);
  reply = { ok: false, description: 'Bad Request: TOPIC_CLOSED' };
  await assert.rejects(tg.send({ text: 'hi', thread: 11 }), /Manage topics/);
  reply = (b) => (b.message_thread_id ? { ok: false, description: 'Bad Request: message thread not found' } : { ok: true });
  await tg.send({ text: 'hi', thread: 99 });
  assert.equal('message_thread_id' in sent.at(-1), false, 'sent to General chat instead');
});

test('an admin links a topic with /topic; others are ignored; the link is saved for the announcer', async () => {
  const file = join(dir, 'gk-topic.json');
  const api = mockApi({ getChatMember: (p) => ({ status: p.user_id === 5 ? 'administrator' : 'member' }) });
  const g = gatekeeper({ call: api.call, chatId: CHAT, stateFile: file, log: quiet });
  await g.handle(groupMsg({ text: '/topic mining', is_topic_message: true, message_thread_id: 33 }));
  assert.deepEqual(g.topics, { mining: 33 });
  assert.equal(api.of('sendMessage')[0].params.message_thread_id, 33);
  assert.match(api.of('sendMessage')[0].params.text, /mining posts/);
  assert.deepEqual(readTopics(file), { mining: 33 });
  await g.handle(groupMsg({ from: { id: 6 }, text: '/topic announcements', is_topic_message: true, message_thread_id: 11 }));
  assert.equal(g.topics.announcements, undefined, 'not an admin');
  await g.handle(groupMsg({ from: { id: 1087968824 }, sender_chat: { id: Number(CHAT) }, text: '/topic@quinviumbot announcements', is_topic_message: true, message_thread_id: 11 }));
  assert.equal(g.topics.announcements, 11, 'an anonymous admin');
  await g.handle(groupMsg({ text: '/topic', is_topic_message: true, message_thread_id: 33 }));
  assert.match(api.of('sendMessage').at(-1).params.text, /announcements: topic 11[\s\S]*general: General chat/);
  await g.handle(groupMsg({ text: 'hello everyone' }));
  assert.equal(api.of('sendMessage').length, 3, 'ordinary messages get no answer');
});

test('"X joined" service messages are deleted', async () => {
  const api = mockApi();
  const g = gatekeeper({ call: api.call, chatId: CHAT, log: quiet });
  await g.handle(groupMsg({ new_chat_members: [{ id: 8 }] }));
  assert.deepEqual(api.of('deleteMessage').map((c) => c.params), [{ chat_id: CHAT, message_id: 70 }]);
});

test('approved members are welcomed together in General chat after 10 minutes, by @name or first name', async () => {
  let t = 1_000_000;
  const file = join(dir, 'gk-welcome.json');
  writeFileSync(file, JSON.stringify({ offset: 0, topics: { general: 44 } }));
  const api = mockApi({ getUpdates: [] });
  const g = gatekeeper({ call: api.call, chatId: CHAT, stateFile: file, log: quiet, now: () => t });
  const press = (from, id) => g.handle({ update_id: id, callback_query: { id: `cq${id}`, from, data: `agree:${CHAT}`, message: { message_id: 1, chat: { id: from.id } } } });
  await press({ id: 1, username: 'alice' }, 1);
  t += 60_000;
  await press({ id: 2, first_name: 'Bob <3' }, 2);
  await g.pollOnce(0);
  assert.equal(api.of('sendMessage').length, 0, 'still inside the window');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).welcome.users.length, 2, 'kept across a restart');
  t += WELCOME_WINDOW_MS;
  await g.pollOnce(0);
  const [w] = api.of('sendMessage');
  assert.equal(w.params.message_thread_id, 44);
  assert.equal(w.params.parse_mode, 'HTML');
  assert.match(w.params.text, /@alice and <a href="tg:\/\/user\?id=2">Bob &lt;3<\/a>/);
  await g.pollOnce(0);
  assert.equal(api.of('sendMessage').length, 1, 'only once');
  assert.match(welcomeText(Array.from({ length: 13 }, (_, i) => ({ id: i, username: `u${i}` }))), /@u9 and 3 others/);
});
