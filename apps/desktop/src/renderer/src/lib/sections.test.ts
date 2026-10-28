import { describe, expect, it } from 'vitest';
import { isApprovalsPath, isBrandPath, isCampaignsPath, isContentPath, isLibraryPath, isStudioPath } from './sections';

describe('studio sections', () => {
  it('keeps campaigns, approvals, library, and brand inside studio', () => {
    for (const path of ['/studio', '/campaigns', '/campaigns/new', '/approvals', '/library', '/brand-kit', '/products/abc', '/analytics']) {
      expect(isStudioPath(path)).toBe(true);
    }
    for (const path of ['/', '/calendar', '/tasks', '/tasks/1', '/knowledge', '/knowledge/profile', '/settings', '/settings/log']) {
      expect(isStudioPath(path)).toBe(false);
    }
  });

  it('keeps products and analytics inside brand, and the knowledge base on its own', () => {
    for (const path of ['/brand-kit', '/products', '/products/abc', '/analytics']) {
      expect(isBrandPath(path)).toBe(true);
    }
    expect(isBrandPath('/knowledge')).toBe(false);
    expect(isBrandPath('/knowledge/sources')).toBe(false);
    expect(isBrandPath('/library')).toBe(false);
    expect(isBrandPath('/campaigns')).toBe(false);
  });

  it('treats posts, documents, and designs as content', () => {
    expect(isContentPath('/studio')).toBe(true);
    expect(isContentPath('/posts/1')).toBe(true);
    expect(isContentPath('/content/1')).toBe(true);
    expect(isContentPath('/designs/new')).toBe(true);
    expect(isContentPath('/campaigns')).toBe(false);
  });

  it('matches each studio item on its own path', () => {
    expect(isCampaignsPath('/campaigns/abc')).toBe(true);
    expect(isApprovalsPath('/approvals')).toBe(true);
    expect(isLibraryPath('/library')).toBe(true);
    expect(isCampaignsPath('/studio')).toBe(false);
  });
});
