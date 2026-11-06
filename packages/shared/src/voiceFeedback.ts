/**
 * A selected passage is swapped in place. The rest of the field stays as the person left it.
 */
export function replaceRange(value: string, start: number, end: number, next: string): string {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(from, Math.min(Math.max(start, end), value.length));
  return value.slice(0, from) + next + value.slice(to);
}

export interface VoiceNote {
  rating: string;
  field: string;
  text: string;
  note: string;
}

/** Recent likes and dislikes, written so the next draft can follow them. */
export function voiceGuidance(notes: VoiceNote[]): string {
  const liked = notes.filter((note) => note.rating === 'up').slice(0, 8);
  const disliked = notes.filter((note) => note.rating === 'down').slice(0, 8);
  if (!liked.length && !disliked.length) return '';
  const line = (note: VoiceNote) => {
    const passage = note.text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const why = note.note.trim().slice(0, 300);
    return `- ${note.field}: "${passage}"${why ? ` — ${why}` : ''}`;
  };
  return [
    'The team has judged recent drafts. Write more like what they liked, and avoid what they disliked.',
    liked.length ? `Liked:\n${liked.map(line).join('\n')}` : '',
    disliked.length ? `Disliked:\n${disliked.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
