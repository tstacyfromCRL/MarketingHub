import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
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
    <div className="pt-2">
      <button type="button" className="flex items-center gap-1 text-xs text-mist/50 hover:text-mist" onClick={() => setShowServer((s) => !s)}>
        {showServer ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Connection settings
      </button>
      {showServer && (
        <Field label="Server" hint="Your IT team provides this address." className="mt-2">
          <input className="input" value={server} onChange={(e) => setServer(e.target.value)} />
        </Field>
      )}
    </div>
  );

  if (mode === 'welcome' && needsBootstrap === true) {
    return (
      <Shell>
        <Wordmark />
        <p className="text-center text-sm text-mist/70">Set up Mantis for your team and teach it your brand.</p>
        <Button className="w-full" onClick={() => go('company')}>Create company</Button>
        <ErrorText error={error} />
        {serverSettings}
      </Shell>
    );
  }

  if (mode === 'welcome') {
    return (
      <Shell>
        <Wordmark />
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
                await signIn(res.token, res.user);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus disabled={needsBootstrap !== false} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={needsBootstrap !== false} />
          <div className="space-y-2 pt-2">
            <Button type="submit" className="w-full" loading={busy} disabled={needsBootstrap !== false}>Login</Button>
            <Button type="button" className="w-full" disabled={needsBootstrap !== false} onClick={() => go('join')}>Create Account</Button>
          </div>
        </form>
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
  const [, subtitle, action] = titles[mode];
  const creating = mode !== 'login';

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <button type="button" className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => go('welcome')}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="text-center">
          <Wordmark />
          <p className="mt-2 text-sm text-mist/70">{subtitle}</p>
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

function Wordmark() {
  return <h1 className="text-center text-3xl font-light tracking-wide text-sage">Mantis</h1>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-ink px-6">
      <div className="w-full max-w-sm space-y-5">{children}</div>
    </div>
  );
}
