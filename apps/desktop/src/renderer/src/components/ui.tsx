import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-sage text-mist hover:bg-sage/90',
  secondary: 'border border-sage/40 bg-transparent text-sage hover:bg-sage/10',
  danger: 'bg-[#6E4E4A] text-mist hover:bg-[#7D5B56]',
  ghost: 'text-mist/80 hover:bg-chrome hover:text-mist',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
      } ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, children, hint, action, className = '' }: { label: string; children: ReactNode; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`block ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        {action}
      </div>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-sm text-sage">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div className={`card w-full ${width} max-h-[90vh] overflow-auto shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <h2 className="text-sage">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-sage hover:bg-ink">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color ?? '#64748b'}33`, color: color ?? '#cbd5e1' }}
    >
      {children}
    </span>
  );
}

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#94a3b8',
  CREATOR_APPROVED: '#38bdf8',
  IN_REVIEW: '#a78bfa',
  SCHEDULED: '#f59e0b',
  POSTED: '#22c55e',
  FAILED: '#f43f5e',
};

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-mist/70">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? 'Loading...'}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-white/10 p-6 text-center text-sm text-mist/60">{children}</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-sm bg-[#6E4E4A]/30 px-3 py-2 text-sm text-mist">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-white/10">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider ${value === t.id ? 'border-sage text-sage' : 'border-transparent text-mist/60 hover:text-mist'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-light tracking-wide text-sage">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mist/75">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function ChipInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-sm border border-transparent bg-mist p-1.5 text-inktext">
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-sm bg-chrome px-2 py-0.5 text-xs text-mist">
          {v}
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-500 hover:text-slate-200" type="button">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none"
        placeholder={placeholder ?? 'Type and press Enter'}
        onKeyDown={(e) => {
          const t = e.currentTarget;
          if (e.key === 'Enter' && t.value.trim()) {
            e.preventDefault();
            onChange([...value, t.value.trim()]);
            t.value = '';
          }
        }}
      />
    </div>
  );
}
