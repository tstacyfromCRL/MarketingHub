import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { helpForPath } from '../lib/featureHelp';

/**
 * One help control for the screen the person is on.
 * Pass path when the route is not the screen, such as the sign-in page.
 */
export function FeatureHelp({ path }: { path?: string }) {
  const location = useLocation();
  const current = path ?? location.pathname;
  const help = helpForPath(current);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        title={`Help: ${help.title}`}
        aria-label={`Help: ${help.title}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-sm p-2 text-sage hover:bg-ink/60"
      >
        <CircleHelp className="h-4 w-4" />
      </button>
      {open && (
        <div role="dialog" aria-label={help.title} className="card absolute right-0 z-40 mt-2 w-80 p-4 text-left shadow-2xl">
          <h2 className="text-sm text-sage">{help.title}</h2>
          <HelpBlock label="What it's for" text={help.purpose} />
          <HelpBlock label="How to use it" text={help.how} />
          <HelpBlock label="Why it matters" text={help.why} />
        </div>
      )}
    </div>
  );
}

function HelpBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-wider text-mist/50">{label}</div>
      <p className="mt-1 text-sm text-mist/85">{text}</p>
    </div>
  );
}
