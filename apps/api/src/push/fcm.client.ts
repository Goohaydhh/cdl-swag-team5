import { importPKCS8, SignJWT } from 'jose';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export type SendResult = 'sent' | 'invalid_token' | 'failed';

/** Minimal Firebase Cloud Messaging HTTP v1 client, using a service-account OAuth token. */
export class FcmClient {
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(private readonly account: ServiceAccount) {}

  /** Sends a data-only, high-priority message: it wakes a killed Android app. */
  async send(token: string, data: Record<string, string>): Promise<SendResult> {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.getAccessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH' } } }),
      },
    );
    if (res.ok) return 'sent';
    // UNREGISTERED (404) and INVALID_ARGUMENT on the token mean the app was uninstalled or reset.
    if (res.status === 404 || res.status === 400) return 'invalid_token';
    return 'failed';
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM OAuth failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
