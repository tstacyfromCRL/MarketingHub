import { z } from 'zod';
import { brandProfileSchema } from './api';

/** Files that belong to the brand kit. Example posts and generated images stay on the computer that made them. */
export const BRAND_KIT_FILE_KINDS = ['LOGO', 'GRAPHIC', 'FONT', 'BACKGROUND'] as const;
export type BrandKitFileKind = (typeof BRAND_KIT_FILE_KINDS)[number];

export const brandKitFileSchema = z.object({
  kind: z.enum(BRAND_KIT_FILE_KINDS),
  name: z.string().min(1),
  mime: z.string().min(1),
  path: z.string().min(1),
});

/**
 * A brand kit zip has no organization id. Importing it fills the company on the computer that receives it.
 * `brand` is the company profile (name, voice, colors, fonts). `files` are the logos, backgrounds, overlays, and font files.
 */
export const brandKitSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1),
  brand: brandProfileSchema,
  files: z.array(brandKitFileSchema),
});

export type BrandKitFile = z.infer<typeof brandKitFileSchema>;
export type BrandKit = z.infer<typeof brandKitSchema>;
