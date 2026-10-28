import { z } from 'zod';
import { SENSITIVITIES } from './api';
import { brandColorsSchema } from './colors';

const sensitivity = z.enum(SENSITIVITIES).default('PUBLIC');
const key = z.string().min(1);

export const packManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const packBrandSchema = z.object({
  companyName: z.string().default(''),
  summary: z.string().default(''),
  tagline: z.string().default(''),
  mission: z.string().default(''),
  audience: z.string().default(''),
  voice: z.string().default(''),
  visualIdentity: z.string().default(''),
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
  colors: brandColorsSchema,
  fonts: z.array(z.object({ role: z.string(), family: z.string() })).default([]),
  website: z.string().default(''),
});

export const packPlaybookSchema = z.object({
  key,
  name: z.string().min(1),
  platform: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  pillar: z.string().nullable().optional(),
  body: z.string().min(1),
  hashtagMin: z.number().int().nonnegative().nullable().optional(),
  hashtagMax: z.number().int().nonnegative().nullable().optional(),
  maxChars: z.number().int().positive().nullable().optional(),
});

export const packProductSchema = z.object({
  key,
  name: z.string().min(1),
  sku: z.string().optional(),
  description: z.string().default(''),
  usage: z.string().optional(),
  partNumbers: z.array(z.string()).optional(),
  features: z.array(z.string()).default([]),
  pricing: z.string().optional(),
  url: z.string().optional(),
  links: z.array(z.string()).default([]),
  sensitivity: sensitivity.optional(),
});

export const packClaimSchema = z.object({
  key,
  text: z.string().min(1),
  sourceUrl: z.string().optional(),
  asOf: z.string().optional(),
  expiresAt: z.string().optional(),
  productKeys: z.array(z.string()).default([]),
  sensitivity: sensitivity.optional(),
});

export const packAccomplishmentSchema = z.object({
  key,
  title: z.string().min(1),
  description: z.string().default(''),
  date: z.string().optional(),
  sensitivity: sensitivity.optional(),
});

export const packSourceSchema = z.object({
  key,
  url: z.string().url(),
  kind: z.enum(['WEBSITE', 'ARTICLE', 'LINKEDIN', 'MANUAL']).default('WEBSITE'),
  recrawlDays: z.number().int().positive().optional(),
  sensitivity: sensitivity.optional(),
});

export const packConfidentialSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export const packExampleFrontmatterSchema = z.object({
  key,
  platform: z.string().min(1),
  pillar: z.string().optional(),
  contentType: z.string().optional(),
});

export const packDocumentMetaSchema = z.object({
  key: z.string().min(1).optional(),
  sensitivity: sensitivity.optional(),
  title: z.string().optional(),
});

export type PackManifest = z.infer<typeof packManifestSchema>;
export type PackBrand = z.infer<typeof packBrandSchema>;
export type PackPlaybook = z.infer<typeof packPlaybookSchema>;
export type PackProduct = z.infer<typeof packProductSchema>;
export type PackClaim = z.infer<typeof packClaimSchema>;
export type PackAccomplishment = z.infer<typeof packAccomplishmentSchema>;
export type PackSource = z.infer<typeof packSourceSchema>;
export type PackConfidential = z.infer<typeof packConfidentialSchema>;
