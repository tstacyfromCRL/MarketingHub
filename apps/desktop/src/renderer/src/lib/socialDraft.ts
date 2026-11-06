/**
 * Save as Draft keeps the social post before a graphic exists.
 * A Canva template and a library photo are not required.
 */
export function socialDraftTitle(title: string, tagline: string): string {
  return title.trim() || tagline.trim() || 'Social post';
}

export function canSaveSocialDraft(input: { title: string; tagline: string; body: string; platforms: string[] }): boolean {
  return Boolean(input.body.trim() && input.platforms.length && (input.title.trim() || input.tagline.trim()));
}
