import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Loads <repo root>/.env (no-op if absent, e.g. platform-provided env vars)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),
  MONGODB_URI: z.string().startsWith('mongodb'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  CLIENT_DIST: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
export const env = parsed.data;
if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) {
  console.error('APP_URL must use https in production (Secure cookies require it).');
  process.exit(1);
}
