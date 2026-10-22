import { describe, expect, it, vi } from 'vitest';
import { createSwagClient, formatCode, speakerLabel, SwagApiError } from './index';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('createSwagClient', () => {
  it('adds the bearer token and the /v1 prefix', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'f' }));
    const api = createSwagClient({ baseUrl: 'http://api:3100/', getToken: () => 'tok', fetch: fetchMock as never });
    await api.family();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api:3100/v1/family');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('refreshes once on 401 and retries', async () => {
    let token = 'old';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { id: 'f' }));
    const api = createSwagClient({
      baseUrl: 'http://api',
      getToken: () => token,
      onUnauthorized: async () => ((token = 'new'), true),
      fetch: fetchMock as never,
    });
    await expect(api.family()).resolves.toEqual({ id: 'f' });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer new' });
  });

  it('turns API errors and network failures into SwagApiError', async () => {
    const api = createSwagClient({
      baseUrl: 'http://api',
      getToken: () => null,
      fetch: (async () => json(404, { error: { code: 'PAIRING_NOT_FOUND', message: 'Code not found' } })) as never,
    });
    await expect(api.joinPairing('K7QF9M2D')).rejects.toMatchObject({ status: 404, code: 'PAIRING_NOT_FOUND' });

    const offline = createSwagClient({ baseUrl: 'http://api', getToken: () => null, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as never });
    const err = await offline.overview().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SwagApiError);
    expect((err as SwagApiError).retryable).toBe(true);
  });

  it('sends the pairing secret header without a bearer token', async () => {
    const fetchMock = vi.fn(async () => json(200, { state: 'claimed' }));
    const api = createSwagClient({ baseUrl: 'http://api', getToken: () => 'tok', fetch: fetchMock as never });
    await api.pollPairing('p1', 'secret', 0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/pairing/sessions/p1?wait=0');
    expect(init.headers).toEqual({ 'ngrok-skip-browser-warning': '1', 'x-pairing-secret': 'secret' });
  });
});

describe('helpers', () => {
  it('formats codes and speaker names like the designs', () => {
    expect(formatCode('k7qf9m2d')).toBe('K7QF-9M2D');
    expect(speakerLabel(['Léa'])).toBe('Léa');
    expect(speakerLabel(['Léa', 'Tom'])).toBe('Léa et Tom');
    expect(speakerLabel(['Léa', 'Tom', 'Inès'])).toBe('Les enfants');
  });
});
