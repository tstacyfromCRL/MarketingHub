import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, ChevronDown, ChevronRight, LogIn, UserPlus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useSession, type User } from '../lib/session';
import { Button, ErrorText, Field } from '../components/ui';

type Mode = 'welcome' | 'company' | 'join' | 'login';

/** First screen: Create New Company (fresh server only), Create New User (invite code) or Login. */
export function LoginPage() {
  const { serverUrl, setServerUrl, signIn } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('welcome');
  const [server, setServer] = useState(serverUrl);
  const [showServer, setShowServer] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNeedsBootstrap(null);
    const t = setTimeout(() => {
      setServerUrl(server);
      api
        .get<{ needsBootstrap: boolean }>('/auth/status')
        .then((s) => {
          setNeedsBootstrap(s.needsBootstrap);
          setError(null);
        })
        .catch((e) => {
          setError(`Can't reach the server at ${server}. ${errorMessage(e)}`);
          setShowServer(true);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [server, setServerUrl]);

  const go = (m: Mode) => {
    setError(null);
    setMode(m);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'company'
          ? await api.post<{ token: string; user: User }>('/auth/bootstrap', { email, name, password })
          : mode === 'join'
            ? await api.post<{ token: string; user: User }>('/auth/join', { code, email, name, password })
            : await api.post<{ token: string; user: User }>('/auth/login', { email, password });
      await signIn(res.token, res.user);
      if (mode === 'company') navigate('/onboarding');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const serverSettings = (
    <div className="border-t border-slate-800 pt-3">
      <button type="button" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300" onClick={() => setShowServer((s) => !s)}>
        {showServer ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Connection settings
      </button>
      {showServer && (
        <Field label="Server" hint="Your IT team provides this address." className="mt-2">
          <input className="input" value={server} onChange={(e) => setServer(e.target.value)} />
        </Field>
      )}
    </div>
  );

  if (mode === 'welcome') {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Marketing Hub</h1>
          <p className="mt-1 text-sm text-slate-400">Plan, create and publish in your company's voice.</p>
        </div>
        <div className="space-y-3">
          <Choice
            icon={<Building2 className="h-5 w-5" />}
            title="Create New Company"
            text={needsBootstrap === false ? 'This server already has a company. Ask your admin for an invite.' : 'Set up Marketing Hub for your team and teach it your brand.'}
            disabled={!needsBootstrap}
            onClick={() => go('company')}
          />
          <Choice
            icon={<UserPlus className="h-5 w-5" />}
            title="Create New User"
            text="Join your team with the invite code your admin gave you."
            disabled={needsBootstrap !== false}
            onClick={() => go('join')}
          />
          <Choice icon={<LogIn className="h-5 w-5" />} title="Login" text="Sign in to your team workspace." disabled={needsBootstrap !== false} onClick={() => go('login')} />
        </div>
        <ErrorText error={error} />
        {serverSettings}
      </Shell>
    );
  }

  const titles: Record<Exclude<Mode, 'welcome'>, [string, string, string]> = {
    company: ['Create New Company', 'First, create your admin account. Next, we set up your brand.', 'Create account and continue'],
    join: ['Create New User', 'Enter the invite code from your admin and choose your password.', 'Create my account'],
    login: ['Login', 'Sign in to your team workspace.', 'Sign in'],
  };
  const [title, subtitle, action] = titles[mode];
  const creating = mode !== 'login';

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <button type="button" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => go('welcome')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        {mode === 'join' && (
          <Field label="Invite code">
            <input className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MH-XXXX-XXXX" required autoFocus />
          </Field>
        )}
        {creating && (
          <Field label="Your name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus={mode === 'company'} />
          </Field>
        )}
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === 'login'} />
        </Field>
        <Field label="Password" hint={creating ? 'At least 8 characters.' : undefined}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={creating ? 8 : 1} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" className="w-full" loading={busy} disabled={needsBootstrap === null}>
          {action}
        </Button>
        {serverSettings}
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="card w-full max-w-md space-y-5 p-8 shadow-2xl">{children}</div>
    </div>
  );
}

function Choice({ icon, title, text, disabled, onClick }: { icon: ReactNode; title: string; text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-left transition hover:border-indigo-500 hover:bg-indigo-950/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:bg-slate-900/60"
    >
      <span className="mt-0.5 text-indigo-300">{icon}</span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-slate-400">{text}</span>
      </span>
    </button>
  );
}
