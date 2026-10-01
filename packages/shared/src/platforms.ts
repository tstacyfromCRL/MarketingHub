export const PLATFORMS = ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PlatformPreset {
  platform: Platform;
  label: string;
  /** Recommended feed image size. */
  width: number;
  height: number;
  aspect: string;
  maxChars: number;
  supportsHashtags: boolean;
}

export const PLATFORM_PRESETS: Record<Platform, PlatformPreset> = {
  facebook: { platform: 'facebook', label: 'Facebook', width: 1200, height: 630, aspect: '1.91:1', maxChars: 63206, supportsHashtags: true },
  instagram: { platform: 'instagram', label: 'Instagram', width: 1080, height: 1350, aspect: '4:5', maxChars: 2200, supportsHashtags: true },
  linkedin: { platform: 'linkedin', label: 'LinkedIn', width: 1200, height: 627, aspect: '1.91:1', maxChars: 3000, supportsHashtags: true },
  x: { platform: 'x', label: 'X', width: 1600, height: 900, aspect: '16:9', maxChars: 280, supportsHashtags: true },
  tiktok: { platform: 'tiktok', label: 'TikTok', width: 1080, height: 1920, aspect: '9:16', maxChars: 2200, supportsHashtags: true },
  youtube: { platform: 'youtube', label: 'YouTube', width: 1280, height: 720, aspect: '16:9', maxChars: 5000, supportsHashtags: true },
};
