import { z } from 'zod';

export const ENV = Symbol('ENV');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3100),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    PAIRING_CODE_PEPPER: z.string().min(8),
    JWT_PRIVATE_KEY_PATH: z.string().default('./keys/jwt-es256.pem'),
    /** After a key rotation: the old private key, accepted for verification only until its tokens expire. */
    JWT_PREVIOUS_KEY_PATH: z.string().optional(),
    /** Browser origins allowed by CORS (HTTP and sockets). Native apps send no Origin. */
    CORS_ORIGINS: z
      .string()
      .default('https://localhost,http://localhost:5173,capacitor://localhost')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
    /** Accept `dev:<family>:<scope>:<id>` socket tokens. Local development only. */
    ALLOW_DEV_TOKENS: z.stringbool().default(false),
    /** S3-compatible storage: RustFS locally, Scaleway Object Storage (fr-par) in production. */
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('fr-par'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    /** Giphy, called only from the backend. Unset = GIF search returns 503. */
    GIPHY_API_KEY: z.string().optional(),
    GIPHY_API_BASE: z.url().default('https://api.giphy.com'),
    /** Only media from hosts ending with this suffix is fetched (SSRF guard). */
    GIPHY_MEDIA_HOST_SUFFIX: z.string().default('.giphy.com'),
    /** Firebase service-account JSON. Unset = pushes are recorded in memory, not sent. */
    FCM_SERVICE_ACCOUNT_PATH: z.string().optional(),
    /** Number of reverse proxies in front of the API (Caddy = 1), for correct client IPs. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.PAIRING_CODE_PEPPER.length < 32 || env.PAIRING_CODE_PEPPER === 'change-me') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAIRING_CODE_PEPPER'],
        message: 'must be a random secret of 32+ characters in production',
      });
    }
    if (env.ALLOW_DEV_TOKENS) {
      ctx.addIssue({ code: 'custom', path: ['ALLOW_DEV_TOKENS'], message: 'must be false in production' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
