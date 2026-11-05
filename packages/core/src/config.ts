import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

function findEnvFile(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return undefined;
    dir = path.dirname(dir);
  }
  return undefined;
}

const envFile = findEnvFile();
if (envFile) loadDotenv({ path: envFile });

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));
const provider = z.enum(['mock', 'openai', 'anthropic', 'local']).default('mock');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string(),
  REDIS_URL: optional,
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  /** Time zone used when writing dates into work log sentences. */
  TEAM_TIMEZONE: z.string().default('America/New_York'),
  ENCRYPTION_KEY: optional,

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('marketing-hub'),
  S3_ACCESS_KEY: optional,
  S3_SECRET_KEY: optional,
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),

  SMTP_URL: optional,
  EMAIL_FROM: z.string().default('Mantis <noreply@example.com>'),
  SLACK_BOT_TOKEN: optional,

  AI_TEXT_PROVIDER: provider,
  AI_IMAGE_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  AI_EMBED_PROVIDER: z.enum(['mock', 'openai', 'local']).default('mock'),
  AI_VISION_PROVIDER: provider,
  IMAGE_EMBED_PROVIDER: z.enum(['histogram', 'clip']).default('histogram'),
  OPENAI_API_KEY: optional,
  OPENAI_TEXT_MODEL: z.string().default('gpt-4o'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2.5-sunburst'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  /** Optional model for the chat assistant only. Empty uses OPENAI_TEXT_MODEL / ANTHROPIC_MODEL. */
  OPENAI_ASSISTANT_MODEL: optional,
  ANTHROPIC_ASSISTANT_MODEL: optional,
  /**
   * OpenAI-compatible server (Ollama's /v1, or vLLM). Qwen2.5 7B Instruct is Apache-2.0 and fits
   * about 8 GB at 4-bit; use qwen2.5:14b when the GPU has about 12 GB. nomic-embed-text is 768-d.
   */
  LOCAL_LLM_BASE_URL: z.string().default('http://127.0.0.1:11434/v1'),
  LOCAL_LLM_API_KEY: optional,
  LOCAL_TEXT_MODEL: z.string().default('qwen2.5:7b'),
  LOCAL_EMBED_MODEL: z.string().default('nomic-embed-text'),
  LOCAL_EMBED_DIMS: z.coerce.number().int().positive().default(768),
  LOCAL_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** Set only when AI_VISION_PROVIDER=local. Leave empty to keep vision on mock, OpenAI, or Anthropic. */
  LOCAL_VISION_MODEL: optional,

  PUBLISH_MODE: z.enum(['direct', 'ayrshare']).default('direct'),
  AYRSHARE_API_KEY: optional,
  META_APP_ID: optional,
  META_APP_SECRET: optional,
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  /** Organization scopes require LinkedIn's Community Management API product on your app. */
  LINKEDIN_SCOPES: z.string().default('openid profile w_member_social w_organization_social rw_organization_admin'),
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  TIKTOK_CLIENT_KEY: optional,
  TIKTOK_CLIENT_SECRET: optional,
  /** Canva Connect app. Redirect URL is PUBLIC_API_URL/canva/callback. Return URL is PUBLIC_API_URL/canva/return. */
  CANVA_CLIENT_ID: optional,
  CANVA_CLIENT_SECRET: optional,

  /** Used only for the default org when no Shopify integration is saved in the app. */
  SHOPIFY_STORE_DOMAIN: optional,
  SHOPIFY_ADMIN_TOKEN: optional,
  SHOPIFY_API_VERSION: z.string().default('2024-10'),
  /** Folder of reference documents watched for the default org. Empty disables the watch. */
  KNOWLEDGE_WATCH_DIR: optional,
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);

/** Absolute path for relative LOCAL_STORAGE_DIR, anchored at the repo root when found. */
export function resolveFromRoot(p: string): string {
  if (path.isAbsolute(p)) return p;
  const root = envFile ? path.dirname(envFile) : process.cwd();
  return path.join(root, p);
}
