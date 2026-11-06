import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { replaceRange } from '@mh/shared';
import { api, errorMessage } from '../lib/api';
import { Button, ErrorText, Field } from './ui';

/**
 * A generated text field. A selection can be rephrased on its own, and a thumb
 * (with an optional note) is kept so later drafts can follow it.
 */
export function VoiceField({
  label,
  hint,
  value,
  onChange,
  field,
  multiline,
  rows = 4,
  disabled,
  action,
  contentType,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  field: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  action?: ReactNode;
  contentType?: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [rephrasing, setRephrasing] = useState(false);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = () => {
    const el = inputRef.current;
    if (!el || el.selectionStart == null || el.selectionEnd == null || el.selectionEnd <= el.selectionStart) {
      setSelection(null);
      return;
    }
    setSelection({ start: el.selectionStart, end: el.selectionEnd });
  };

  const rephrase = async () => {
    if (!selection) return;
    const passage = value.slice(selection.start, selection.end);
    if (passage.trim().length < 1) return;
    if (passage.length > 2000) {
      setError('Select a shorter passage.');
      return;
    }
    setRephrasing(true);
    setError(null);
    try {
      const result = await api.post<{ text: string }>('/generate/rephrase', { text: passage, field, contentType });
      onChange(replaceRange(value, selection.start, selection.end, result.text.trim() || passage));
      setSelection(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRephrasing(false);
    }
  };

  const judge = async (next: 'up' | 'down') => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const row = await api.post<{ id: string }>('/generate/feedback', { field, text: value, rating: next, note });
      setRating(next);
      setFeedbackId(row.id);
      setSaved(!note.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!feedbackId) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/generate/feedback/${feedbackId}`, { note });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const selected = Boolean(selection);
  return (
    <div className="space-y-2">
      <Field
        label={label}
        hint={hint}
        action={
          <span className="flex items-center gap-1">
            {selected && (
              <Button type="button" size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => void rephrase()} loading={rephrasing} disabled={disabled}>
                Rephrase selection
              </Button>
            )}
            {action}
          </span>
        }
      >
        {multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            className="input"
            rows={rows}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onMouseUp={capture}
            onKeyUp={capture}
          />
        ) : (
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            className="input"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onMouseUp={capture}
            onKeyUp={capture}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" title="This sounds like us" disabled={disabled || busy || !value.trim()} onClick={() => void judge('up')} className={`rounded p-1 ${rating === 'up' ? 'bg-sage/20 text-sage' : 'text-slate-500 hover:text-slate-200'}`}>
          <ThumbsUp className="h-4 w-4" />
        </button>
        <button type="button" title="This does not sound like us" disabled={disabled || busy || !value.trim()} onClick={() => void judge('down')} className={`rounded p-1 ${rating === 'down' ? 'bg-rose-950 text-rose-300' : 'text-slate-500 hover:text-slate-200'}`}>
          <ThumbsDown className="h-4 w-4" />
        </button>
        {rating && <span className="text-xs text-slate-500">{rating === 'up' ? 'Liked' : 'Disliked'}. Add a note if you want later drafts to know why.</span>}
      </div>
      {rating && (
        <div className="flex items-start gap-2">
          <textarea className="input text-sm" rows={2} value={note} disabled={disabled} placeholder={rating === 'up' ? 'What should we keep doing?' : 'What should we stop doing?'} onChange={(e) => { setNote(e.target.value); setSaved(false); }} />
          <Button type="button" size="sm" variant="secondary" onClick={() => void saveNote()} loading={busy} disabled={!feedbackId || saved}>Save note</Button>
        </div>
      )}
      {saved && <p className="text-xs text-slate-500">Saved. The next draft will take this into account.</p>}
      <ErrorText error={error} />
    </div>
  );
}
