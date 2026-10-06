// Smoke test: a parent and a child connect to /rt; the child sends a status, the parent must receive it.
// Usage (API running locally): node scripts/smoke-rt.cjs
const { io } = require('socket.io-client');
const { randomUUID } = require('node:crypto');

const base = process.env.API_URL ?? 'http://localhost:3100';
const familyId = randomUUID();
const childId = randomUUID();

const parent = io(`${base}/rt`, { auth: { token: `dev:${familyId}:parent:${randomUUID()}` } });
const child = io(`${base}/rt`, { auth: { token: `dev:${familyId}:child:${childId}` } });

const timeout = setTimeout(() => fail('timed out'), 5000);

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

parent.on('status_updated', (e) => {
  if (e.data.child_id !== childId || e.data.status !== 'at_home') fail('unexpected payload');
  console.log('parent received status_updated:', e.data.status, 'seq', e.seq);
  clearTimeout(timeout);
  parent.close();
  child.close();
  console.log('PASS');
});

let connected = 0;
for (const s of [parent, child]) {
  s.on('connect', () => {
    if (++connected < 2) return;
    child.emit(
      'status_update',
      {
        client_event_id: randomUUID(),
        child_id: childId,
        status: 'at_home',
        occurred_at: new Date().toISOString(),
      },
      (ack) => {
        console.log('child ack:', JSON.stringify(ack));
        if (!ack.ok) fail('status_update was rejected');
      },
    );
  });
}
