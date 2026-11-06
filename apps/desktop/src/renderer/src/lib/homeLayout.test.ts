import { describe, expect, it } from 'vitest';
import {
  addHomeWidget,
  allowedHomeWidgets,
  canShrinkHomeColumns,
  canShrinkHomeRows,
  defaultHomeLayout,
  loadHomeLayout,
  moveHomeWidget,
  removeHomeWidget,
  sanitizeHomeLayout,
  saveHomeLayout,
  setHomeColumns,
  setHomeRows,
  widgetsAvailableToAdd,
  type HomeLayout,
  type LayoutStorage,
} from './homeLayout';

function memory(): LayoutStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function layout(widgets: HomeLayout['widgets'], columns = 3, rows = 2): HomeLayout {
  return { columns, rows, widgets };
}

describe('home layout', () => {
  it('starts as 3 columns and 2 rows, with review only for a manager', () => {
    expect(defaultHomeLayout(true)).toEqual({
      columns: 3,
      rows: 2,
      widgets: ['review', 'calendar', 'tasks', 'activity', 'links'],
    });
    expect(defaultHomeLayout(false).widgets).toEqual(['calendar', 'tasks', 'activity', 'links']);
    expect(defaultHomeLayout(false).columns).toBe(3);
    expect(defaultHomeLayout(false).rows).toBe(2);
  });

  it('offers the extra widgets without putting them on the page for everyone', () => {
    expect(allowedHomeWidgets(false)).toEqual(['calendar', 'tasks', 'activity', 'links', 'drafts', 'notifications', 'campaigns', 'articles', 'events']);
    expect(allowedHomeWidgets(true)).toContain('review');
    const creator = defaultHomeLayout(false);
    expect(creator.widgets).not.toContain('drafts');
    expect(widgetsAvailableToAdd(creator, false)).toEqual(['drafts', 'notifications', 'campaigns', 'articles', 'events']);
  });

  it('keeps a saved grid, and reads an older list as widgets inside 3 by 2', () => {
    expect(sanitizeHomeLayout(['links', 'tasks', 'nope', 'tasks', 'calendar'], false)).toEqual(layout(['links', 'tasks', 'calendar']));
    expect(sanitizeHomeLayout(['review', 'tasks'], false).widgets).toEqual(['tasks']);
    expect(sanitizeHomeLayout({ columns: 4, rows: 3, widgets: ['drafts', 'events', 'notifications'] }, false)).toEqual(
      layout(['drafts', 'events', 'notifications'], 4, 3),
    );
    expect(sanitizeHomeLayout({ columns: 0, rows: 99, widgets: ['tasks'] }, false)).toEqual(layout(['tasks'], 1, 8));
    expect(sanitizeHomeLayout('not-a-list', true)).toEqual(defaultHomeLayout(true));
  });

  it('grows a row when a new widget has no cell, and will not shrink a widget off the page', () => {
    const full = layout(['calendar', 'tasks', 'links', 'activity', 'drafts', 'events']);
    expect(addHomeWidget(full, 'notifications', false)).toEqual(
      layout(['calendar', 'tasks', 'links', 'activity', 'drafts', 'events', 'notifications'], 3, 3),
    );
    expect(canShrinkHomeRows(full)).toBe(false);
    expect(setHomeRows(full, 1)).toEqual(full);
    expect(canShrinkHomeColumns(layout(['calendar', 'tasks'], 2, 1))).toBe(false);
    expect(setHomeColumns(layout(['calendar'], 2, 1), 4)).toEqual(layout(['calendar'], 4, 1));
    expect(setHomeRows(layout(['calendar'], 3, 2), 4)).toEqual(layout(['calendar'], 3, 4));
    expect(setHomeColumns(layout(['calendar'], 3, 2), 9)).toEqual(layout(['calendar'], 6, 2));
  });

  it('adds, removes, and moves widgets without inventing a second copy', () => {
    const start = removeHomeWidget(defaultHomeLayout(false), 'activity');
    expect(start.widgets).toEqual(['calendar', 'tasks', 'links']);
    expect(widgetsAvailableToAdd(start, false)).toEqual(['activity', 'drafts', 'notifications', 'campaigns', 'articles', 'events']);
    const added = addHomeWidget(start, 'activity', false);
    expect(added.widgets).toEqual(['calendar', 'tasks', 'links', 'activity']);
    expect(added.columns).toBe(3);
    expect(addHomeWidget(added, 'activity', false)).toEqual(added);
    expect(addHomeWidget(start, 'review', false)).toEqual(start);
    expect(addHomeWidget(start, 'events', false).widgets).toEqual(['calendar', 'tasks', 'links', 'events']);
    expect(moveHomeWidget(layout(['calendar', 'tasks', 'links']), 'links', 'calendar').widgets).toEqual(['links', 'calendar', 'tasks']);
    expect(moveHomeWidget(layout(['calendar', 'tasks']), 'missing', 'tasks')).toEqual(layout(['calendar', 'tasks']));
  });

  it('remembers one person\'s grid and leaves a broken save as the default', () => {
    const storage = memory();
    saveHomeLayout('ada', layout(['links', 'tasks'], 4, 2), storage);
    expect(loadHomeLayout('ada', false, storage)).toEqual(layout(['links', 'tasks'], 4, 2));
    expect(loadHomeLayout('grace', false, storage)).toEqual(defaultHomeLayout(false));
    storage.setItem('mantis.home.layout.ada', '{');
    expect(loadHomeLayout('ada', false, storage)).toEqual(defaultHomeLayout(false));
    storage.setItem('mantis.home.layout.ada', JSON.stringify(['links', 'tasks']));
    expect(loadHomeLayout('ada', false, storage)).toEqual(layout(['links', 'tasks']));
  });
});
