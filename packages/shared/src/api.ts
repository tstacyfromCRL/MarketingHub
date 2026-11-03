import { z } from 'zod';
import { ROLES } from './roles';
import { PLATFORMS } from './platforms';
import { POST_ACTIONS } from './postWorkflow';
import { designDocSchema } from './design';
import { assetKindForPath } from './library';
import { brandColorsSchema } from './colors';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---- Auth & users ----
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const bootstrapSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(ROLES),
  slackUserId: z.string().optional(),
});
export const joinSchema = z.object({
  code: z.string().trim().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});
export const inviteSchema = z.object({
  role: z.enum(ROLES).default('CREATOR'),
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  slackUserId: z.string().nullable().optional(),
});
export const notificationPrefsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  slack: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { inApp: true, email: true, slack: false };

// ---- Quick links ----
export const quickLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  /** Company-wide links are shown to everyone and require manager role. */
  shared: z.boolean().default(false),
  sort: z.number().int().default(0),
});

// ---- Library ----
export const libraryAssetSchema = z.object({
  relPath: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtime: z.string(),
  kind: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER']),
  /** PNG thumbnail, base64, optional. */
  thumbnail: z.string().optional(),
});
export const libraryAssetBatchSchema = z.object({
  leaseToken: z.string(),
  assets: z.array(libraryAssetSchema).max(200),
});
export const libraryImportSchema = z.object({
  relPath: z.string().default(''),
  kind: z.enum(['FOLDER', 'FILE']),
});
export const libraryImportBatchSchema = z.object({
  paths: z.array(libraryImportSchema).min(1).max(200),
});
export const libraryBatchEditSchema = z
  .object({
    ids: z.array(z.string()).min(1).max(200),
    addTags: z.array(z.string().trim().min(1)).max(30).optional(),
    productId: z.string().optional(),
    /** Drop the files from the library index. The files stay on the shared drive. */
    remove: z.boolean().optional(),
    /** true keeps the files in the library but out of AI. false lets AI read them again, unless a parent folder is still flagged. */
    notForPublicUse: z.boolean().optional(),
  })
  .refine((v) => v.addTags?.length || v.productId || v.remove || v.notForPublicUse !== undefined, { message: 'Choose tags, a product, remove, or a public-use flag' });
export const libraryHoldSchema = z.object({
  relPath: z.string().default(''),
  kind: z.enum(['FOLDER', 'FILE']),
  hidden: z.boolean(),
});
export const libraryRelocateSchema = z.object({
  folder: z.string().trim().min(1),
  moves: z.array(z.object({ id: z.string(), relPath: z.string().min(1) })).min(1).max(200),
});
export const libraryScanCompleteSchema = z.object({
  leaseToken: z.string(),
  /** Every relPath seen during a full scan; anything else gets marked missing. */
  seenPaths: z.array(z.string()),
});
export { assetKindForPath };

// ---- Tasks / kanban ----
export const stageSchema = z.object({ name: z.string().min(1), color: hexColor.default('#64748b') });
export const stageReorderSchema = z.object({ stageIds: z.array(z.string()) });
export const categorySchema = z.object({ name: z.string().min(1), color: hexColor.default('#6366f1') });
export const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  stageId: z.string(),
  assigneeId: z.string().nullable().default(null),
  dueDate: z.string().datetime().nullable().default(null),
  categoryIds: z.array(z.string()).default([]),
});
export const taskUpdateSchema = taskSchema.partial().extend({
  /** false archives the task. It stays stored and leaves the working board. */
  active: z.boolean().optional(),
});
export const taskMoveSchema = z.object({ stageId: z.string(), order: z.number() });

// ---- Team calendar ----
export const scheduleEventSchema = z.object({
  title: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  allDay: z.boolean().default(false),
  notes: z.string().default(''),
  userId: z.string().optional(),
});

// ---- Knowledge base ----
export const SOURCE_KINDS = ['WEBSITE', 'ARTICLE', 'LINKEDIN', 'MANUAL', 'SAMPLE_POST', 'DOCUMENT'] as const;
export const SENSITIVITIES = ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const brandProfileSchema = z.object({
  companyName: z.string().default(''),
  summary: z.string().default(''),
  website: z.string().default(''),
  tagline: z.string().default(''),
  mission: z.string().default(''),
  voice: z.string().default(''),
  visualIdentity: z.string().default(''),
  audience: z.string().default(''),
  colors: brandColorsSchema,
  fonts: z.array(z.object({ role: z.string(), family: z.string() })).default([]),
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
});
export type BrandProfileInput = z.infer<typeof brandProfileSchema>;

export const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().default(''),
  /** What the product does. */
  description: z.string().default(''),
  /** How the product is used. Omitted on a partial update so a name-only patch does not clear it. */
  usage: z.string().optional(),
  /** Full part-number list. The first one is also stored as sku so catalog matching still works. */
  partNumbers: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  features: z.array(z.string()).default([]),
  url: z.string().default(''),
  pricing: z.string().default(''),
  links: z.array(z.string().url()).max(20).default([]),
  active: z.boolean().default(true),
});

export const marketLinkSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.enum(['COMPETITOR', 'PARTNER']),
  url: z.string().url(),
  productId: z.string().nullable().optional(),
});
export const accomplishmentSchema = z.object({
  title: z.string().min(1),
  date: isoDate.nullable().default(null),
  description: z.string().default(''),
});
export const sourceSchema = z.object({
  url: z.string().url().optional(),
  kind: z.enum(SOURCE_KINDS),
  title: z.string().default(''),
  /** For LINKEDIN / MANUAL / SAMPLE_POST sources the user pastes the text. */
  content: z.string().default(''),
  platform: z.string().nullable().default(null),
  recrawlDays: z.number().int().positive().nullable().default(null),
});

// ---- Company setup ----
export const ONBOARDING_STEPS = ['name', 'about', 'summary', 'logos', 'colors', 'voice', 'analyze', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const onboardingStateSchema = z.object({
  step: z.enum(ONBOARDING_STEPS).default('name'),
  completedAt: z.string().datetime().nullable().default(null),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export const summarizeCompanySchema = z
  .object({ description: z.string().default(''), url: z.string().url().optional().or(z.literal('').transform(() => undefined)) })
  .refine((v) => v.description.trim() || v.url, { message: 'Describe your company or enter your website' });
export const companySummarySchema = z.object({
  summary: z.string().default(''),
  tagline: z.string().default(''),
  mission: z.string().default(''),
  audience: z.string().default(''),
});
export type CompanySummary = z.infer<typeof companySummarySchema>;
export const suggestedProductSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  pricing: z.string().default(''),
  url: z.string().default(''),
});
export type SuggestedProduct = z.infer<typeof suggestedProductSchema>;
export const ANALYZE_STEPS = ['website', 'samples', 'logos', 'voice'] as const;
export type AnalyzeStep = (typeof ANALYZE_STEPS)[number];
export interface AnalyzeProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  /** Steps finished so far. */
  done: AnalyzeStep[];
  current: AnalyzeStep | null;
  error?: string;
  suggestedProducts: SuggestedProduct[];
}
export const assetProductSchema = z.object({ productId: z.string(), confirmed: z.boolean() });

// ---- Content generation ----
export const CONTENT_TYPES = ['SOCIAL_POST', 'EMAIL', 'BLOG', 'DOCUMENTATION'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const generateTextSchema = z.object({
  type: z.enum(CONTENT_TYPES),
  brief: z.string().min(1),
  platform: z.enum(PLATFORMS).optional(),
  productIds: z.array(z.string()).default([]),
  tone: z.string().optional(),
});
/** Studio social post: brief → tagline, sub-tagline, and feed copy as separate fields. */
export const generateSocialDraftSchema = z.object({
  brief: z.string().min(1),
  platform: z.enum(PLATFORMS).optional(),
  productIds: z.array(z.string()).default([]),
});
export const generateImageSchema = z.object({
  prompt: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const contentDocSchema = z.object({
  type: z.enum(CONTENT_TYPES),
  title: z.string().min(1),
  body: z.string(),
});

// ---- Designs ----
export const designSchema = z.object({ name: z.string().min(1), doc: designDocSchema });
export const composeDesignSchema = z.object({
  headline: z.string(),
  subline: z.string().default(''),
  platform: z.enum(PLATFORMS),
  imagePrompt: z.string().optional(),
  productAssetId: z.string().optional(),
});

// ---- Posts & campaigns ----
export const outputWarningSchema = z.object({ code: z.string(), message: z.string() });
export const postSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  aiWarnings: z.array(outputWarningSchema).default([]),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  scheduledAt: z.string().datetime().nullable().default(null),
  designId: z.string().nullable().default(null),
  perPlatformFiles: z.boolean().default(true),
});
export const postUpdateSchema = postSchema.partial().extend({
  variants: z
    .array(z.object({ platform: z.enum(PLATFORMS), body: z.string(), designId: z.string().nullable().optional() }))
    .optional(),
});
export const postTransitionSchema = z.object({
  action: z.enum(POST_ACTIONS),
  note: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});
export const campaignSchema = z.object({
  name: z.string().min(1),
  brief: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  postDays: z.array(z.number().int().min(0).max(6)).min(1),
  postTimes: z.array(hhmm).min(1),
  utcOffsetMinutes: z.number().int(),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  perPlatformFiles: z.boolean().default(true),
  productIds: z.array(z.string()).default([]),
  generateGraphics: z.boolean().default(true),
});
