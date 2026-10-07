// Creates a demo family through the real API and prints working credentials for the apps.
// Usage (API running locally): pnpm --filter @swag/api seed:dev
const base = `${process.env.API_URL ?? 'http://localhost:3100'}/v1`;
const stamp = Date.now().toString(36);

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const email = `demo-${stamp}@swag.local`;
const password = 'demo password 123';
const owner = await call('POST', '/auth/register', {
  email,
  password,
  display_name: 'Alex',
  family_name: 'Martin',
  consent: true,
  device: { name: 'Demo phone' },
});
const parentToken = owner.tokens.access_token;

const lea = await call('POST', '/children', { display_name: 'Léa', avatar_key: 'fox', color: '#FF7043' }, parentToken);
const tom = await call(
  'POST',
  '/children',
  { display_name: 'Tom', avatar_key: 'panda', color: '#42A5F5', pin: '1234' },
  parentToken,
);

const pairing = await call('POST', '/pairing/sessions', { device_info: { model: 'Redmi Pad 2 (seed)' } });
await call('POST', '/pairing/claim', { code: pairing.code }, parentToken);
await call(
  'POST',
  `/pairing/sessions/${pairing.pairing_id}/approve`,
  { device_name: 'Kitchen tablet', child_ids: [lea.id, tom.id] },
  parentToken,
);
const paired = await call('GET', `/pairing/sessions/${pairing.pairing_id}?wait=0`, null, null, {
  'x-pairing-secret': pairing.poll_secret,
});
const device = await call('POST', '/device/token', { device_id: paired.device_id, credential: paired.credential });
const leaSession = await call('POST', '/device/child-session', { child_id: lea.id }, device.access_token);

await call('POST', '/allowed-urls', { url: 'fr.vikidia.org', title: 'Vikidia' }, parentToken);

console.log(`
Demo family "Martin" created.

Parent app login
  email:     ${email}
  password:  ${password}

Tablet (store these like a paired tablet would)
  device_id:   ${paired.device_id}
  credential:  ${device.credential}

Children
  Léa  ${lea.id}  (no PIN)
  Tom  ${tom.id}  (PIN 1234)

Short-lived tokens for quick tests (30 min / 15 min)
  Léa child token:  ${leaSession.access_token}
  parent token:     ${parentToken}
`);
