// Sending to Telegram and X. Without the keys a channel only prints what it would send (dry run).
import { createHmac, randomBytes } from 'node:crypto';

/** Telegram Bot API: the bot must be an administrator of the channel. */
export function telegram({ token, chat, fetch: f = fetch, log = console.log }) {
  if (!token || !chat) return { name: 'telegram', dry: true, send: async (msg) => log(`[dry-run telegram]\n${msg.text}\n`) };
  return {
    name: 'telegram', dry: false,
    /** @param {{text: string, link?: string}} msg HTML text; the link is shown as a preview card above the text. */
    async send(msg) {
      const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat, text: msg.text, parse_mode: 'HTML',
          link_preview_options: msg.link ? { url: msg.link, prefer_large_media: true, show_above_text: false } : { is_disabled: true },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(`telegram ${r.status}: ${j.description ?? 'error'}`);   // the token is never printed
    },
  };
}

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a header for a user-context request (RFC 5849). A JSON body is not part of the signature; form parameters would be. */
export function oauthHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000), formParams = {} }) {
  const params = {
    oauth_consumer_key: consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp), oauth_token: token, oauth_version: '1.0',
  };
  const u = new URL(url);
  const all = [...Object.entries(params), ...u.searchParams.entries(), ...Object.entries(formParams)].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...params, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

/** X API v2, POST /2/tweets with the keys of an app on the free tier (Read and Write). */
export function x({ apiKey, apiSecret, accessToken, accessSecret, fetch: f = fetch, log = console.log }) {
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return { name: 'x', dry: true, send: async (msg) => log(`[dry-run x]\n${msg.text}\n`) };
  const url = 'https://api.x.com/2/tweets';
  return {
    name: 'x', dry: false,
    /** @param {{text: string}} msg */
    async send(msg) {
      const r = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: oauthHeader({ method: 'POST', url, consumerKey: apiKey, consumerSecret: apiSecret, token: accessToken, tokenSecret: accessSecret }) },
        body: JSON.stringify({ text: msg.text }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(`x ${r.status}: ${j.detail ?? j.title ?? 'error'}`);
      }
    },
  };
}
