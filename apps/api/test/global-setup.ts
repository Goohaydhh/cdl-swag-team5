import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { createClient } from 'redis';

const PG_HOST = process.env.TEST_PG_HOST ?? 'localhost';
const REDIS_HOST = process.env.TEST_REDIS_HOST ?? 'localhost';
const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000';
const ADMIN_URL = `postgresql://swag:swag@${PG_HOST}:5432/postgres`;
const TEST_DB = 'swag_test';
const TEST_URL = `postgresql://swag:swag@${PG_HOST}:5432/${TEST_DB}`;

/** Creates and migrates the test database, empties it and Redis DB 1, and ensures the test bucket. */
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  try {
    execSync('pnpm exec prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'pipe',
    });
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`Test database migration failed:\n${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`);
  }

  const db = new Client({ connectionString: TEST_URL });
  await db.connect();
  await db.query('TRUNCATE families, pairing_sessions, audit_log RESTART IDENTITY CASCADE');
  await db.end();

  const redis = createClient({ url: `redis://${REDIS_HOST}:6379/1` });
  await redis.connect();
  await redis.flushDb();
  await redis.close();

  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: 'fr-par',
    forcePathStyle: true,
    credentials: { accessKeyId: 'swag', secretAccessKey: 'swag-dev-secret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'swag-test' })).catch((err: { name?: string }) => {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') throw err;
  });
}
