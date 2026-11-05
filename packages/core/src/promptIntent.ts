import { PLATFORMS, type Platform } from '@mh/shared';

export interface Person {
  id: string;
  name: string;
}

export type PromptIntent =
  | { kind: 'unknown' }
  | { kind: 'clarify'; question: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'task'; title: string; assigneeId: string | null; assigneeName: string | null; when: string | null }
  | { kind: 'post'; platform: Platform; brief: string; when: string | null };

const PLATFORM_WORDS: Record<string, Platform> = {
  linkedin: 'linkedin',
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube',
  twitter: 'x',
  x: 'x',
};

/**
 * Plain language may create a draft or a task.
 * Publishing, approving, and deleting stay on their buttons, so a sentence cannot send a post.
 */
export function interpretPrompt(text: string, people: Person[]): PromptIntent {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return { kind: 'clarify', question: 'Tell me the post or task you want to start.' };
  if (isUnsafe(cleaned)) {
    return {
      kind: 'refuse',
      message: 'I can start a draft or a task. Publishing, approving, and deleting stay on their buttons.',
    };
  }

  const task = readTask(cleaned);
  if (task) return finishTask(task, people);

  const post = readPost(cleaned);
  if (post) return post;

  return { kind: 'unknown' };
}

/** Uses a short follow-up, such as a full name, to fill the gap the first sentence left. */
export function withFollowUp(original: string, followUp: string): string {
  const extra = followUp.trim();
  if (!extra) return original;
  const named = original.match(/task\s+for\s+(.+?)\s+to\s+/i);
  if (named && extra.split(/\s+/).length <= 4 && !/\b(task|post|create|draft)\b/i.test(extra)) {
    return original.replace(named[1], extra);
  }
  if (PLATFORM_WORDS[extra.toLowerCase()]) return original.replace(/\bpost\b/i, `${extra} post`);
  return `${original} ${extra}`;
}

export function resolveWhen(phrase: string | null, now: Date): Date | null {
  if (!phrase) return null;
  const word = phrase.trim().toLowerCase();
  if (word === 'today') return atHour(now, 0, 17);
  if (word === 'tomorrow') return atHour(now, 1, 9);
  if (word === 'next week') return nextMonday(now);
  const parsed = new Date(phrase);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

/** Turns a model's JSON answer into the same intent the rules use. Invalid JSON asks for a clearer sentence. */
export function intentFromModel(raw: string, people: Person[]): PromptIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'clarify', question: 'I can start a draft or a task. Say which one, and what it is about.' };
  }
  const row = parsed as { action?: string; platform?: string; brief?: string; title?: string; assignee?: string; when?: string | null; question?: string; message?: string };
  if (row.action === 'refuse') {
    return { kind: 'refuse', message: row.message || 'I can start a draft or a task. Publishing, approving, and deleting stay on their buttons.' };
  }
  if (row.action === 'clarify') {
    return { kind: 'clarify', question: row.question || 'Can you say a little more about what you want?' };
  }
  if (row.action === 'create-task') {
    const title = (row.title || '').trim();
    if (!title) return { kind: 'clarify', question: 'What should the task say?' };
    return finishTask({ title, assignee: (row.assignee || '').trim() || null, when: row.when ?? null }, people);
  }
  if (row.action === 'create-post') {
    const platform = normalizePlatform(row.platform || '');
    const brief = (row.brief || '').trim();
    if (!platform) return { kind: 'clarify', question: 'Which network should this post go on? LinkedIn, Facebook, Instagram, X, TikTok, or YouTube.' };
    if (!brief) return { kind: 'clarify', question: 'What should the post be about?' };
    return { kind: 'post', platform, brief, when: row.when ?? null };
  }
  return { kind: 'unknown' };
}

function isUnsafe(text: string): boolean {
  const making = /\b(create|write|make|add|new|start)\b/i.test(text);
  const harmful = /\b(delete|archive|approve|publish|unschedule)\b/i.test(text);
  return harmful && !making;
}

function readTask(text: string): { title: string; assignee: string | null; when: string | null } | null {
  if (!/\btask\b/i.test(text)) return null;
  const assigned = text.match(/\btask\s+for\s+(.+?)\s+to\s+(.+)$/i);
  if (assigned) {
    const rest = splitWhen(assigned[2]);
    return { assignee: assigned[1].trim(), title: sentence(rest.body), when: rest.when };
  }
  const loose = text.match(/\btask\s+(?:to\s+)?(.+)$/i);
  if (!loose) return null;
  const rest = splitWhen(loose[1].replace(/^for\s+/i, ''));
  const forPerson = rest.body.match(/^([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)?)\s+to\s+(.+)$/);
  if (forPerson) return { assignee: forPerson[1], title: sentence(forPerson[2]), when: rest.when };
  return { assignee: null, title: sentence(rest.body.replace(/^for\s+/i, '')), when: rest.when };
}

function readPost(text: string): PromptIntent | null {
  if (!/\bpost\b/i.test(text)) return null;
  const named = text.match(/\b(linkedin|facebook|instagram|tiktok|youtube|twitter|x)\s+post\s+(?:about\s+)?(.+)$/i);
  if (named) {
    const rest = splitWhen(named[2]);
    if (!rest.body) return { kind: 'clarify', question: 'What should the post be about?' };
    return { kind: 'post', platform: PLATFORM_WORDS[named[1].toLowerCase()], brief: rest.body, when: rest.when };
  }
  if (/\bpost\b/i.test(text)) {
    return { kind: 'clarify', question: 'Which network should this post go on? LinkedIn, Facebook, Instagram, X, TikTok, or YouTube.' };
  }
  return null;
}

function finishTask(task: { title: string; assignee: string | null; when: string | null }, people: Person[]): PromptIntent {
  if (!task.title) return { kind: 'clarify', question: 'What should the task say?' };
  if (!task.assignee) {
    return { kind: 'task', title: task.title, assigneeId: null, assigneeName: null, when: task.when };
  }
  const found = matchPerson(task.assignee, people);
  if (found.kind === 'none') {
    return { kind: 'clarify', question: `I don't see anyone named ${task.assignee} on the team. Who should this task go to?` };
  }
  if (found.kind === 'many') {
    return { kind: 'clarify', question: `Which person do you mean: ${found.names.join(' or ')}?` };
  }
  return { kind: 'task', title: task.title, assigneeId: found.person.id, assigneeName: found.person.name, when: task.when };
}

export function matchPerson<P extends Person>(query: string, people: P[]): { kind: 'one'; person: P } | { kind: 'many'; names: string[] } | { kind: 'none' } {
  const needle = query.trim().toLowerCase();
  const hits = people.filter((person) => {
    const full = person.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    return full === needle || first === needle || full.startsWith(`${needle} `);
  });
  if (hits.length === 1) return { kind: 'one', person: hits[0] };
  if (hits.length > 1) return { kind: 'many', names: hits.map((person) => person.name) };
  return { kind: 'none' };
}

function splitWhen(text: string): { body: string; when: string | null } {
  const match = text.trim().match(/^(.*?)(?:\s+for)?\s+(today|tomorrow|next week)\s*$/i);
  if (!match) return { body: text.trim(), when: null };
  return { body: match[1].replace(/[,\s]+$/g, '').trim(), when: match[2].toLowerCase() };
}

function sentence(text: string): string {
  const trimmed = text.replace(/[.?!]+$/g, '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizePlatform(value: string): Platform | null {
  const key = value.trim().toLowerCase();
  if ((PLATFORMS as readonly string[]).includes(key)) return key as Platform;
  return PLATFORM_WORDS[key] ?? null;
}

function atHour(now: Date, addDays: number, hour: number): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + addDays);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function nextMonday(now: Date): Date {
  const day = now.getDay();
  const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  return atHour(now, add, 9);
}
