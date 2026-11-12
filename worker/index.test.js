// node --test worker/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const sent = [];
let room = true;
const env = {
  LIMIT: { limit: async () => ({ success: room }) },
  TURNSTILE_SECRET: 's',
  CONTACT_TO: 'inbox@example.com',
  CONTACT_FROM: 'formulier@example.com',
  EMAIL: { send: async (m) => sent.push(m) },
};
let human = true;
let reachable = true;
globalThis.fetch = async () => {
  if (!reachable) throw new Error('network');
  return Response.json({ success: human });
};

const good = { naam: 'Jan', mail: 'jan@example.com', bericht: 'Hoi', onderwerp: 'website' };
const post = (fields, headers = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries({ ...good, 'cf-turnstile-response': 't', ...fields }))
    body.set(k, v);
  return worker.fetch(
    new Request('https://site.test/api/contact', {
      method: 'POST',
      body,
      headers: { Origin: 'https://site.test', ...headers },
    }),
    env,
  );
};

test('a good message is mailed, with the visitor as reply-to', async () => {
  sent.length = 0;
  assert.equal((await post({})).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'inbox@example.com');
  assert.equal(sent[0].replyTo, 'jan@example.com');
});

test('a filled honeypot looks fine to the bot and sends nothing', async () => {
  sent.length = 0;
  assert.equal((await post({ website: 'http://spam' })).status, 200);
  assert.equal(sent.length, 0);
});

test('bad input, a failed Turnstile check and other origins are refused', async () => {
  sent.length = 0;
  assert.equal((await post({ mail: 'geen-mail' })).status, 400);
  assert.equal((await post({ bericht: 'x'.repeat(5001) })).status, 400);
  assert.equal((await post({ onderwerp: 'hack' })).status, 400);
  assert.equal((await post({}, { Origin: 'https://evil.test' })).status, 403);
  human = false;
  assert.equal((await post({})).status, 403);
  human = true;
  reachable = false;
  assert.equal((await post({})).status, 502);
  reachable = true;
  assert.equal(sent.length, 0);
});

test('too many messages from one address are refused', async () => {
  sent.length = 0;
  room = false;
  assert.equal((await post({})).status, 429);
  room = true;
  assert.equal(sent.length, 0);
});

test('a line break in the name cannot add mail headers', async () => {
  sent.length = 0;
  await post({ naam: 'Jan\r\nBcc: x@evil.test' });
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});

test('other paths and methods are refused', async () => {
  const get = await worker.fetch(new Request('https://site.test/api/contact'), env);
  assert.equal(get.status, 405);
  const other = await worker.fetch(new Request('https://site.test/api/x', { method: 'POST' }), env);
  assert.equal(other.status, 404);
});
