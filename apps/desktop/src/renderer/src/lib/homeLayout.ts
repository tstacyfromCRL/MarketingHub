/**
 * Which home-page widgets a person sees, in what order, and how the grid is divided.
 * The list is theirs alone, stored on this computer, so one teammate's arrangement
 * does not change anyone else's. An id this version does not know is ignored, so an
 * older saved list cannot blank the page.
 *
 * Every widget occupies one cell. Columns and rows only change how many equal cells
 * the page is divided into. The grid will not shrink past the widgets already on it,
 * because a widget should not disappear just because the frame got smaller.
 *
 * defaultOn marks the widgets that appear for everyone. The others are offered in
 * Customize so the home page does not change under people who never asked for them.
 */

export const HOME_WIDGETS = [
  { id: 'review', title: 'Waiting for review', managerOnly: true, defaultOn: true },
  { id: 'calendar', title: 'Social calendar', managerOnly: false, defaultOn: true },
  { id: 'tasks', title: 'My tasks', managerOnly: false, defaultOn: true },
  { id: 'activity', title: 'Work log', managerOnly: false, defaultOn: true },
  { id: 'links', title: 'Quick links', managerOnly: false, defaultOn: true },
  { id: 'drafts', title: 'My drafts', managerOnly: false, defaultOn: false },
  { id: 'notifications', title: 'Notifications', managerOnly: false, defaultOn: false },
  { id: 'campaigns', title: 'Campaigns', managerOnly: false, defaultOn: false },
  { id: 'articles', title: 'Recent articles', managerOnly: false, defaultOn: false },
  { id: 'events', title: 'Team events', managerOnly: false, defaultOn: false },
] as const;

export type HomeWidgetId = (typeof HOME_WIDGETS)[number]['id'];

/** Six equal cells. Wide enough for the default sections, short enough to see at once. */
export const DEFAULT_HOME_COLUMNS = 3;
export const DEFAULT_HOME_ROWS = 2;

/** Past six columns the cells stop being readable on a desktop window. Eight rows is already a long page. */
export const MIN_HOME_COLUMNS = 1;
export const MAX_HOME_COLUMNS = 6;
export const MIN_HOME_ROWS = 1;
export const MAX_HOME_ROWS = 8;

export interface HomeLayout {
  columns: number;
  rows: number;
  widgets: HomeWidgetId[];
}

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (userId: string) => `mantis.home.layout.${userId}`;

export function isHomeWidgetId(value: unknown): value is HomeWidgetId {
  return typeof value === 'string' && HOME_WIDGETS.some((widget) => widget.id === value);
}

export function homeWidget(id: HomeWidgetId) {
  const widget = HOME_WIDGETS.find((item) => item.id === id);
  if (!widget) throw new Error(`Unknown home widget ${id}`);
  return widget;
}

/** Every widget this person is allowed to put on the page. */
export function allowedHomeWidgets(manager: boolean): HomeWidgetId[] {
  return HOME_WIDGETS.filter((widget) => manager || !widget.managerOnly).map((widget) => widget.id);
}

function defaultWidgets(manager: boolean): HomeWidgetId[] {
  return HOME_WIDGETS.filter((widget) => widget.defaultOn && (manager || !widget.managerOnly)).map((widget) => widget.id);
}

/** The layout a person starts with, and what Reset layout returns to. */
export function defaultHomeLayout(manager: boolean): HomeLayout {
  return { columns: DEFAULT_HOME_COLUMNS, rows: DEFAULT_HOME_ROWS, widgets: defaultWidgets(manager) };
}

function cleanWidgets(value: unknown, manager: boolean): HomeWidgetId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<HomeWidgetId>();
  const widgets: HomeWidgetId[] = [];
  for (const item of value) {
    if (!isHomeWidgetId(item) || seen.has(item)) continue;
    if (homeWidget(item).managerOnly && !manager) continue;
    seen.add(item);
    widgets.push(item);
  }
  return widgets;
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Grow rows, then columns, until every widget has a cell. Stops at the limits. */
function fitGrid(columns: number, rows: number, widgets: HomeWidgetId[]): HomeLayout {
  let nextColumns = columns;
  let nextRows = rows;
  while (widgets.length > nextColumns * nextRows && nextRows < MAX_HOME_ROWS) nextRows += 1;
  while (widgets.length > nextColumns * nextRows && nextColumns < MAX_HOME_COLUMNS) nextColumns += 1;
  return { columns: nextColumns, rows: nextRows, widgets };
}

/**
 * Keep a saved order, drop repeats, and hide widgets this person cannot see.
 * A bare list is an older save from before the grid had a size, so it keeps
 * that order inside the default 3 by 2.
 */
export function sanitizeHomeLayout(value: unknown, manager: boolean): HomeLayout {
  const fallback = defaultHomeLayout(manager);
  if (Array.isArray(value)) return fitGrid(fallback.columns, fallback.rows, cleanWidgets(value, manager));
  if (!value || typeof value !== 'object') return fallback;
  const record = value as { columns?: unknown; rows?: unknown; widgets?: unknown };
  const widgets = Array.isArray(record.widgets) ? cleanWidgets(record.widgets, manager) : fallback.widgets;
  const columns = wholeNumber(record.columns, DEFAULT_HOME_COLUMNS, MIN_HOME_COLUMNS, MAX_HOME_COLUMNS);
  const rows = wholeNumber(record.rows, DEFAULT_HOME_ROWS, MIN_HOME_ROWS, MAX_HOME_ROWS);
  return fitGrid(columns, rows, widgets);
}

export function moveHomeWidget(layout: HomeLayout, activeId: string, overId: string): HomeLayout {
  const from = layout.widgets.indexOf(activeId as HomeWidgetId);
  const to = layout.widgets.indexOf(overId as HomeWidgetId);
  if (from < 0 || to < 0 || from === to) return layout;
  const widgets = layout.widgets.slice();
  const [moved] = widgets.splice(from, 1);
  widgets.splice(to, 0, moved!);
  return { ...layout, widgets };
}

/** Adds the widget in the next cell. Grows the grid by a row when every cell is taken. */
export function addHomeWidget(layout: HomeLayout, id: HomeWidgetId, manager: boolean): HomeLayout {
  if (layout.widgets.includes(id)) return layout;
  if (!allowedHomeWidgets(manager).includes(id)) return layout;
  const fitted = fitGrid(layout.columns, layout.rows, [...layout.widgets, id]);
  if (fitted.widgets.length > fitted.columns * fitted.rows) return layout;
  return fitted;
}

export function removeHomeWidget(layout: HomeLayout, id: HomeWidgetId): HomeLayout {
  return { ...layout, widgets: layout.widgets.filter((item) => item !== id) };
}

export function setHomeColumns(layout: HomeLayout, columns: number): HomeLayout {
  const next = wholeNumber(columns, layout.columns, MIN_HOME_COLUMNS, MAX_HOME_COLUMNS);
  if (layout.widgets.length > next * layout.rows) return layout;
  return { ...layout, columns: next };
}

export function setHomeRows(layout: HomeLayout, rows: number): HomeLayout {
  const next = wholeNumber(rows, layout.rows, MIN_HOME_ROWS, MAX_HOME_ROWS);
  if (layout.widgets.length > layout.columns * next) return layout;
  return { ...layout, rows: next };
}

export function canShrinkHomeColumns(layout: HomeLayout): boolean {
  return layout.columns > MIN_HOME_COLUMNS && layout.widgets.length <= (layout.columns - 1) * layout.rows;
}

export function canShrinkHomeRows(layout: HomeLayout): boolean {
  return layout.rows > MIN_HOME_ROWS && layout.widgets.length <= layout.columns * (layout.rows - 1);
}

/** Widgets this person can add that are not on the page yet, in catalog order. */
export function widgetsAvailableToAdd(layout: HomeLayout, manager: boolean): HomeWidgetId[] {
  return allowedHomeWidgets(manager).filter((id) => !layout.widgets.includes(id));
}

export function loadHomeLayout(userId: string, manager: boolean, storage: LayoutStorage): HomeLayout {
  try {
    const raw = storage.getItem(storageKey(userId));
    if (raw == null) return defaultHomeLayout(manager);
    return sanitizeHomeLayout(JSON.parse(raw) as unknown, manager);
  } catch {
    return defaultHomeLayout(manager);
  }
}

export function saveHomeLayout(userId: string, layout: HomeLayout, storage: LayoutStorage): void {
  storage.setItem(storageKey(userId), JSON.stringify(layout));
}
