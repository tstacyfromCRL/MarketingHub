import { describe, expect, it } from 'vitest';
import { helpForPath } from './featureHelp';

describe('feature help', () => {
  it('explains each main screen, including a page inside that screen', () => {
    expect(helpForPath('/').title).toBe('Home');
    expect(helpForPath('/').how).toMatch(/bottom right/);
    expect(helpForPath('/').how).toMatch(/chat drawer/);
    expect(helpForPath('/').how).toMatch(/Customize/);
    expect(helpForPath('/').how).toMatch(/3 columns by 2 rows/);
    expect(helpForPath('/').how).toMatch(/Team events/);
    expect(helpForPath('/tasks/task-1').title).toBe('Tasks');
    expect(helpForPath('/posts/post-1').title).toBe('Post');
    expect(helpForPath('/designs/new').title).toBe('Design editor');
    expect(helpForPath('/designs/new').how).toMatch(/Align/);
    expect(helpForPath('/designs/new').how).toMatch(/Guides/);
    expect(helpForPath('/designs/new').how).toMatch(/Pen/);
    expect(helpForPath('/designs/new').how).toMatch(/Nodes/);
    expect(helpForPath('/designs/new').how).toMatch(/tangent/);
    expect(helpForPath('/products/sku-1').title).toBe('Products');
    expect(helpForPath('/campaigns/new').title).toBe('Campaigns');
    expect(helpForPath('/studio').how).toMatch(/Save as Draft/);
    expect(helpForPath('/studio').how).toMatch(/Re-Write/);
    expect(helpForPath('/studio').how).toMatch(/Rephrase selection/);
    expect(helpForPath('/studio').how).toMatch(/Thumbs up/);
    expect(helpForPath('/posts/post-1').how).toMatch(/Rephrase selection/);
    expect(helpForPath('/content/doc-1').how).toMatch(/Thumbs up/);
    expect(helpForPath('/studio').how).toMatch(/hashtags/);
    expect(helpForPath('/studio').how).toMatch(/Drafts/);
    expect(helpForPath('/studio').how).toMatch(/PNG/);
    expect(helpForPath('/studio').how).toMatch(/Edit opens the post/);
    expect(helpForPath('/studio').how).toMatch(/Delete asks/);
  });

  it('picks the knowledge tab you are on, not a generic knowledge page', () => {
    expect(helpForPath('/knowledge').title).toBe('Brand profile');
    expect(helpForPath('/knowledge/profile').title).toBe('Brand profile');
    expect(helpForPath('/knowledge/playbooks').title).toBe('Playbooks');
    expect(helpForPath('/knowledge/catalog').purpose).toMatch(/product/i);
    expect(helpForPath('/knowledge/search').title).toBe('What the AI knows');
    expect(helpForPath('/knowledge/articles').title).toBe('Articles');
    expect(helpForPath('/posts/post-1').how).toMatch(/saved article/);
  });

  it('picks the settings tab you are on', () => {
    expect(helpForPath('/settings').title).toBe('My settings');
    expect(helpForPath('/settings/general').title).toBe('My settings');
    expect(helpForPath('/settings/social').title).toBe('Social accounts');
    expect(helpForPath('/settings/users').title).toBe('Team');
    expect(helpForPath('/settings/log').title).toBe('Work log');
    expect(helpForPath('/settings/system').title).toBe('System');
  });

  it('explains sign-in and setup, and still has an answer for an unknown screen', () => {
    expect(helpForPath('/login').how).toMatch(/invite/i);
    expect(helpForPath('/onboarding').title).toBe('Company setup');
    const unknown = helpForPath('/somewhere-else');
    expect(unknown.title).toBe('Mantis');
    expect(unknown.purpose.length).toBeGreaterThan(0);
    expect(unknown.how.length).toBeGreaterThan(0);
    expect(unknown.why.length).toBeGreaterThan(0);
  });
});
