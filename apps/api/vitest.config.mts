import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Service hosts: localhost with docker compose, service aliases in GitLab CI.
const pg = process.env.TEST_PG_HOST ?? 'localhost';
const redis = process.env.TEST_REDIS_HOST ?? 'localhost';
const s3 = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000';

// End-to-end tests run the real NestJS app against a separate database and Redis DB 1,
// so local development data is never touched. Requires `pnpm db:up`.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://swag:swag@${pg}:5432/swag_test`,
      REDIS_URL: `redis://${redis}:6379/1`,
      PAIRING_CODE_PEPPER: 'test-pepper-not-secret',
      JWT_PRIVATE_KEY_PATH: './keys/jwt-test.pem',
      ALLOW_DEV_TOKENS: 'false',
      TRUST_PROXY_HOPS: '1',
      S3_ENDPOINT: s3,
      S3_REGION: 'fr-par',
      S3_BUCKET: 'swag-test',
      S3_ACCESS_KEY: 'swag',
      S3_SECRET_KEY: 'swag-dev-secret',
      GIPHY_API_KEY: '',
      FEATURE_SITES: 'true',
    },
  },
});
