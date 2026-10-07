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

// Avatars and colours match the SWAG design (Gremlin mascots).
const lea = await call('POST', '/children', { display_name: 'Léa', avatar_key: 'gremlin-pink', color: '#F472B6' }, parentToken);
const tom = await call('POST', '/children', { display_name: 'Tom', avatar_key: 'gremlin-blue', color: '#3B9BF0' }, parentToken);
const ines = await call('POST', '/children', { display_name: 'Inès', avatar_key: 'gremlin-orange', color: '#FF8A3D' }, parentToken);

// Same flow as the apps: the parent generates the code, the tablet joins, the parent validates.
const pairing = await call('POST', '/pairing/sessions', {}, parentToken);
const joined = await call('POST', '/pairing/join', {
  code: pairing.code,
  pairing_id: pairing.pairing_id,
  device_info: { model: 'Redmi Pad 2 (seed)' },
});
await call('POST', `/pairing/sessions/${pairing.pairing_id}/approve`, { device_name: 'Tablette du salon' }, parentToken);
const paired = await call('GET', `/pairing/sessions/${pairing.pairing_id}?wait=0`, null, null, {
  'x-pairing-secret': joined.poll_secret,
});
const device = await call('POST', '/device/token', { device_id: paired.device_id, credential: paired.credential });

console.log(`
Demo family "Martin" created.

Parent app login
  email:     ${email}
  password:  ${password}

Tablet (already paired; or pair a fresh one from the parent app: Famille > Associer une tablette)
  device_id:   ${paired.device_id}
  credential:  ${device.credential}

Children (all three on the tablet)
  Léa   ${lea.id}
  Tom   ${tom.id}
  Inès  ${ines.id}

Short-lived tokens for quick tests (15 min)
  tablet token:  ${device.access_token}
  parent token:  ${parentToken}
`);
