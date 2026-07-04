// The F1_AUTH_TOKEN env var accepts either the bare subscription JWT or the whole
// `login-session` cookie value from formula1.com — normalizeAuthToken unwraps it.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthToken } from '../server/signalr/client.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

test('bare JWT passes through untouched', () => {
  assert.equal(normalizeAuthToken(JWT), JWT);
});

test('login-session cookie value (URL-encoded JSON) unwraps to the subscription token', () => {
  const cookie = encodeURIComponent(JSON.stringify({ data: { subscriptionToken: JWT, other: 'x' } }));
  assert.equal(normalizeAuthToken(cookie), JWT);
});

test('un-encoded cookie JSON also unwraps', () => {
  const cookie = JSON.stringify({ data: { subscriptionToken: JWT } });
  assert.equal(normalizeAuthToken(cookie), JWT);
});

test('empty / missing token stays null', () => {
  assert.equal(normalizeAuthToken(null), null);
  assert.equal(normalizeAuthToken(''), null);
});

test('garbage that mentions subscriptionToken but is not JSON falls through as-is', () => {
  const weird = 'subscriptionToken-but-not-json';
  assert.equal(normalizeAuthToken(weird), weird);
});
