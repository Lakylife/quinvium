// The community assistant with a mocked Claude client: no network, no cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAILY_LIMIT, ERROR_TEXT, LIMIT_TEXT, MAX_INPUT, MODEL, PER_USER_HOUR, REFUSAL_TEXT, assistant, cost, networkFacts, systemPrompt, trigger } from '../src/assistant.js';
import { gatekeeper } from '../src/gatekeeper.js';

const CHAT = '-1005888614238';
const ME = { id: 999, username: 'quinviumbot', is_bot: true };
const quiet = () => {};
const dir = mkdtempSync(join(tmpdir(), 'assistant-'));
const usage = { input_tokens: 180, cache_read_input_tokens: 2300, cache_creation_input_tokens: 0, output_tokens: 250 };

function fakeClient(reply = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Chain ID 52401.' }], usage })) {
  const calls = [];
  return { calls, messages: { create: async (params) => { calls.push(params); return reply(params); } } };
}
const group = (o = {}) => ({ message_id: 7, chat: { id: Number(CHAT), type: 'supergroup', is_forum: true }, from: { id: 5, first_name: 'A' }, is_topic_message: true, message_thread_id: 50, ...o });
const mention = (text = '@quinviumbot what is the chain id?', o = {}) => group({ text, entities: [{ type: 'mention', offset: text.indexOf('@'), length: 12 }], ...o });
const snap = { height: 12_345, hashrate: 2_500_000, supply: '49380000000000000000000', reward: '4000000000000000000', halvingInterval: 8_000_000, blockTime: 15, day: { blocks: 5_700, miners: 9, txs: 40 }, release: { tag: 'v2.16.2' } };

test('triggers: a mention or a reply to the bot in the group, a private message; never bots, commands or quiet topics', () => {
  const ctx = { me: ME, community: CHAT, topics: { announcements: 11, mining: 33, rules: 2 } };
  assert.deepEqual(trigger(mention(), ctx), { question: 'what is the chain id?', repliedTo: null, where: 'group' });
  assert.equal(trigger(group({ text: 'what is the chain id?' }), ctx), null, 'not addressed to the bot');
  const reply = trigger(group({ text: 'and testnet?', reply_to_message: { from: { id: ME.id }, text: 'Chain ID 52401.' } }), ctx);
  assert.deepEqual(reply, { question: 'and testnet?', repliedTo: 'Chain ID 52401.', where: 'group' });
  assert.equal(trigger(group({ text: 'hi', reply_to_message: { from: { id: 77 }, forum_topic_created: {}, text: '' } }), ctx), null, 'a plain topic message is not a reply');
  for (const thread of [11, 33, 2]) assert.equal(trigger(mention(undefined, { message_thread_id: thread }), ctx), null, `quiet topic ${thread}`);
  assert.equal(trigger(mention(undefined, { from: { id: 6, is_bot: true } }), ctx), null, 'bots');
  assert.equal(trigger(mention('/topic mining @quinviumbot'), ctx), null, 'commands');
  assert.equal(trigger(mention(undefined, { chat: { id: -100123, type: 'supergroup' } }), ctx), null, 'another group');
  assert.equal(trigger({ chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'how do I mine?' }, ctx).where, 'private');
  assert.equal(trigger(mention('@quinviumbot'), ctx), null, 'a bare mention has no question');
  const long = trigger(mention(`@quinviumbot ${'x'.repeat(5000)}`), ctx);
  assert.equal(long.question.length, MAX_INPUT + 2, 'long questions are cut');
});

test('the request: Haiku, low effort, a cached frozen system prompt, live numbers only in the user message', async () => {
  const client = fakeClient();
  const a = assistant({ client, facts: () => snap, log: quiet, now: () => Date.UTC(2026, 10, 27, 12) });
  assert.equal(await a.answer(5, { question: 'what is the chain id?', repliedTo: 'earlier text' }), 'Chain ID 52401.');
  const [p] = client.calls;
  assert.equal(p.model, MODEL);
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.ok(p.max_tokens <= 1000);
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(p.system[0].text, systemPrompt(), 'the same bytes every time');
  assert.doesNotMatch(p.system[0].text, /12,345|Etherscan/, 'no live numbers and no Etherscan in the cached part');
  assert.match(p.system[0].text, /52401/);
  assert.match(p.system[0].text, /financial advice/);
  assert.equal(p.messages.length, 1, 'no history');
  const content = p.messages[0].content;
  assert.match(content, /height 12,345/);
  assert.match(content, /latest release v2\.16\.2/);
  assert.match(content, /next halving at block 8,000,000/);
  assert.match(content, /<replied_to>\nearlier text\n<\/replied_to>/);
  assert.match(content, /<question>\nwhat is the chain id\?\n<\/question>/);
  assert.match(networkFacts(null), /not available/);
});

test('one answer costs well under $0.002 with the cache, and the estimate follows the usage numbers', () => {
  assert.ok(cost(usage) < 0.0005, `cached answer ${cost(usage)}`);
  const cold = { input_tokens: 180, cache_creation_input_tokens: 2300, output_tokens: 600 };
  assert.ok(cost(cold) < 0.002, `first answer ${cost(cold)}`);
  assert.equal(cost({ input_tokens: 1_000_000 }), 0.10);
  assert.equal(cost({ output_tokens: 1_000_000 }), 0.50);
});

test('caps: 5 answers an hour per user (told once), a daily total, kept across restarts', async () => {
  let t = Date.UTC(2026, 10, 27, 12);
  const stateFile = join(dir, 'assistant.json');
  const client = fakeClient();
  const a = assistant({ client, log: quiet, now: () => t, stateFile, dailyLimit: 7 });
  for (let i = 0; i < PER_USER_HOUR; i++) assert.equal(await a.answer(5, { question: 'q' }), 'Chain ID 52401.');
  assert.equal(await a.answer(5, { question: 'q' }), LIMIT_TEXT);
  assert.equal(await a.answer(5, { question: 'q' }), null, 'told only once');
  assert.equal(client.calls.length, PER_USER_HOUR);
  const again = assistant({ client, log: quiet, now: () => t, stateFile, dailyLimit: 7 });
  assert.equal(await again.answer(5, { question: 'q' }), null, 'the limit survives a restart');
  assert.equal(await again.answer(6, { question: 'q' }), 'Chain ID 52401.');
  assert.equal(await again.answer(7, { question: 'q' }), 'Chain ID 52401.');
  assert.equal(await again.answer(8, { question: 'q' }), null, 'daily total reached');
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).answers, 7);
  t += 86_400_000;
  assert.equal(await again.answer(8, { question: 'q' }), 'Chain ID 52401.', 'a new day');
  assert.equal(DAILY_LIMIT, 150);
});

test('a refusal, an empty answer and an API error get a short polite reply; the log has numbers, not texts', async () => {
  const lines = [];
  const refusing = assistant({ client: fakeClient(() => ({ stop_reason: 'refusal', stop_details: { category: null }, content: [], usage })), log: (l) => lines.push(l) });
  assert.equal(await refusing.answer(5, { question: 'secret question text' }), REFUSAL_TEXT);
  const empty = assistant({ client: fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }], usage })), log: quiet });
  assert.equal(await empty.answer(5, { question: 'q' }), ERROR_TEXT);
  const failing = assistant({ client: { messages: { create: async () => { throw Object.assign(new Error('boom'), { status: 529 }); } } }, log: (l) => lines.push(l) });
  assert.equal(await failing.answer(5, { question: 'q' }), ERROR_TEXT);
  assert.ok(lines.some((l) => /\$0\.000\d+/.test(l) && /cache read 2300/.test(l)));
  assert.ok(lines.every((l) => !l.includes('secret question text') && !l.includes('Chain ID')));
});

test('in the group the answer replies to the question in the same topic; private questions need membership', async () => {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getChatMember') return { status: params.user_id === 5 ? 'member' : 'left' };
    return true;
  };
  const helper = assistant({ client: fakeClient(), log: quiet });
  const g = gatekeeper({ call, chatId: CHAT, log: quiet, assistant: helper, me: ME });
  await g.handle({ update_id: 1, message: mention() });
  const sent = calls.filter((c) => c.method === 'sendMessage');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.message_thread_id, 50);
  assert.equal(sent[0].params.reply_parameters.message_id, 7);
  assert.equal(sent[0].params.text, 'Chain ID 52401.');
  assert.equal(sent[0].params.parse_mode, undefined, 'plain text');
  await g.handle({ update_id: 2, message: { message_id: 3, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'how do I mine?' } });
  assert.equal(calls.filter((c) => c.method === 'sendMessage').at(-1).params.text, 'Chain ID 52401.');
  await g.handle({ update_id: 3, message: { message_id: 4, chat: { id: 6, type: 'private' }, from: { id: 6 }, text: 'how do I mine?' } });
  assert.match(calls.filter((c) => c.method === 'sendMessage').at(-1).params.text, /invite link/, 'not a member: how to join');
  const before = calls.length;
  const off = gatekeeper({ call, chatId: CHAT, log: quiet, me: ME });
  await off.handle({ update_id: 4, message: mention() });
  assert.equal(calls.length, before, 'without the assistant nothing happens');
});
