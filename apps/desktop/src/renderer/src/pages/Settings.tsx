import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, Link2, Plus, RefreshCw, Ticket, Trash2 } from 'lucide-react';
import { ROLES, type LibraryLocation as LibraryLocationSetting, type NotificationPrefs, type PlatformPreset, type Role } from '@mh/shared';
import { api, download, errorMessage, queryClient } from '../lib/api';
import { isAdmin, isManager, useSession, type User } from '../lib/session';
import { formatDate, formatWhen } from '../lib/format';
import { useUsers, type TeamUser } from '../lib/hooks';
import { BrandMark } from '../components/BrandMark';
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { LibraryLocation } from '../components/LibraryLocation';
import { CanvaAccountCard } from '../components/Canva';
import { WorkLogPage } from './WorkLog';

export function SettingsPage() {
  const { user } = useSession();
  const { pathname } = useLocation();
  const tabs = [
    { to: 'general', label: 'My settings', show: true },
    { to: 'social', label: 'Social accounts', show: isManager(user) },
    { to: 'users', label: 'Team', show: isAdmin(user) },
    { to: 'log', label: 'Log', show: true },
    { to: 'system', label: 'System', show: isAdmin(user) },
  ].filter((t) => t.show);
  const wide = pathname.startsWith('/settings/log');
  return (
    <div>
      <div className="max-w-4xl">
        <PageHeader title="Settings" />
        <div className="mb-6 flex gap-1 border-b border-white/10">
          {tabs.map((t) => (
            <NavLink key={t.to} to={`/settings/${t.to}`} className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider ${isActive ? 'border-sage text-sage' : 'border-transparent text-mist/60 hover:text-mist'}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className={wide ? '' : 'max-w-4xl'}>
        <Routes>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<General />} />
          <Route path="social" element={<Social />} />
          <Route path="users" element={<Users />} />
          <Route path="log" element={<WorkLogPage embedded />} />
          <Route path="system" element={<System />} />
        </Routes>
      </div>
    </div>
  );
}

function General() {
  const { user, setUser, serverUrl } = useSession();
  const [prefs, setPrefs] = useState<NotificationPrefs>(user!.notificationPrefs);
  const [slackUserId, setSlackUserId] = useState(user!.slackUserId ?? '');
  const version = useQuery({ queryKey: ['app-version'], queryFn: () => window.api.app.version() });
  const save = useMutation({
    mutationFn: () => api.patch<User>('/me/preferences', { ...prefs, slackUserId }),
    onSuccess: (u) => setUser(u),
  });
  return (
    <div className="space-y-6">
      <Card title="Asset library location">
        <p className="mb-3 text-sm text-slate-400">
          The network drive that holds the team's media. An admin selects it once; each person's PC finds it automatically, whatever drive letter it's mapped to.
        </p>
        <LibraryLocation />
      </Card>
      <Card title="Notifications">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.inApp} onChange={(e) => setPrefs({ ...prefs, inApp: e.target.checked })} /> In the app (with desktop pop-ups)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} /> Email to {user!.email}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.slack} onChange={(e) => setPrefs({ ...prefs, slack: e.target.checked })} /> Slack direct message</label>
          {prefs.slack && (
            <Field label="Slack member ID" hint="In Slack: click your profile picture → Profile → ⋮ → Copy member ID (looks like U01ABCDEF).">
              <input className="input w-64 font-mono" value={slackUserId} onChange={(e) => setSlackUserId(e.target.value)} placeholder="U01ABCDEF" />
            </Field>
          )}
          <p className="text-xs text-slate-500">You're notified about task assignments, task moves, posts needing your review, returned posts, approvals, and publishing results.</p>
          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
            {save.isSuccess && <span className="text-sm text-emerald-400">Saved</span>}
            <ErrorText error={save.error ? errorMessage(save.error) : null} />
          </div>
        </div>
      </Card>
      <Card title="About">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <BrandMark className="h-5 w-auto" />
          <span>{version.data ?? ''} · connected to <span className="font-mono">{serverUrl}</span> as {user!.name} ({user!.role.toLowerCase()})</span>
        </div>
      </Card>
    </div>
  );
}

interface SocialAccount { id: string; platform: string; displayName: string; externalId: string; expiresAt: string | null; createdAt: string; connectedBy: { name: string } | null }

function Social() {
  const platforms = useQuery({ queryKey: ['social-platforms'], queryFn: () => api.get<(PlatformPreset & { configured: boolean; publishMode: string })[]>('/social/platforms') });
  const accounts = useQuery({ queryKey: ['social-accounts'], queryFn: () => api.get<{ accounts: SocialAccount[]; defaults: Record<string, string> }>('/social/accounts') });
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['social-accounts'] });

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh(), 3000);
    const stop = setTimeout(() => setWaiting(false), 180_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting]);

  const connect = async (platform: string) => {
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>(`/social/connect/${platform}`);
      await window.api.app.openExternal(url);
      setWaiting(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setDefault = async (platform: string, accountId: string) => {
    const defaults = { ...(accounts.data?.defaults ?? {}), [platform]: accountId };
    await api.put('/social/defaults', defaults);
    void refresh();
  };

  if (!platforms.data || !accounts.data) return <Spinner />;
  const mode = platforms.data[0]?.publishMode;
  return (
    <div className="space-y-4">
      {mode === 'ayrshare' && <p className="rounded-md bg-sky-950/50 px-3 py-2 text-sm text-sky-200">Publishing goes through Ayrshare. Link social profiles in your Ayrshare dashboard; connections below are optional.</p>}
      <CanvaAccountCard />
      {waiting && <p className="text-sm text-slate-400">Finish signing in in your browser. This list refreshes automatically.</p>}
      <ErrorText error={error} />
      {platforms.data.map((p) => {
        const list = accounts.data.accounts.filter((a) => a.platform === p.platform);
        const def = accounts.data.defaults[p.platform] ?? list[0]?.id;
        return (
          <Card key={p.platform} title={p.label} actions={
            p.configured
              ? <Button size="sm" variant="secondary" onClick={() => void connect(p.platform)}><Link2 className="h-3.5 w-3.5" /> {list.length ? 'Connect another' : 'Connect'}</Button>
              : <Badge>Not configured on the server</Badge>
          }>
            {list.length === 0 ? <p className="text-sm text-slate-500">{p.configured ? 'No accounts connected.' : 'An admin needs to add this platform\'s app credentials to the server configuration.'}</p> : (
              <div className="space-y-2">
                {list.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-sm">
                    <input type="radio" name={`def-${p.platform}`} checked={def === a.id} onChange={() => void setDefault(p.platform, a.id)} title="Post here by default" />
                    <span className="flex-1">{a.displayName}</span>
                    {a.expiresAt && new Date(a.expiresAt) < new Date(Date.now() + 7 * 86_400_000) && <Badge color="#f59e0b">Token expires {formatDate(a.expiresAt)}</Badge>}
                    <span className="text-xs text-slate-500">by {a.connectedBy?.name ?? 'unknown'} · {formatDate(a.createdAt)}</span>
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Disconnect ${a.displayName}?`) && void api.del(`/social/accounts/${a.id}`).then(refresh)}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
                  </div>
                ))}
                <p className="text-xs text-slate-500">Scheduled posts go to the selected account.</p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Users() {
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [inviting, setInviting] = useState(false);
  if (!users.data) return <Spinner />;
  return (
    <div>
      <div className="mb-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add person directly</Button>
        <Button onClick={() => setInviting(true)}><Ticket className="h-4 w-4" /> Invite someone</Button>
      </div>
      <PendingInvites />
      <div className="card divide-y divide-slate-800">
        {users.data.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${u.active ? '' : 'opacity-50'}`}>
            <div className="flex-1">
              <div className="text-sm">{u.name} {!u.active && <Badge>deactivated</Badge>}</div>
              <div className="text-xs text-slate-500">{u.email}{u.lastLoginAt ? ` · last sign-in ${formatWhen(u.lastLoginAt)}` : ' · never signed in'}</div>
            </div>
            <Badge color={u.role === 'ADMIN' ? '#f43f5e' : u.role === 'MANAGER' ? '#a78bfa' : '#38bdf8'}>{u.role.toLowerCase()}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">Creators make content and approve their own drafts. Managers also review, edit, approve and schedule posts, and connect social accounts. Admins also manage people, task stages and system settings.</p>
      {(adding || editing) && <UserModal user={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null); }} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </div>
  );
}

interface Invite {
  id: string;
  code: string;
  role: Role;
  email: string | null;
  expiresAt: string;
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-2 py-1 font-mono text-sm hover:bg-slate-700"
      title="Copy code"
      onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
    >
      {code} {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
    </button>
  );
}

function PendingInvites() {
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get<Invite[]>('/invites') });
  if (!invites.data?.length) return null;
  return (
    <div className="card mb-4 p-4">
      <div className="mb-2 text-sm font-medium">Pending invites</div>
      <div className="space-y-2">
        {invites.data.map((i) => (
          <div key={i.id} className="flex items-center gap-3 text-sm">
            <CopyCode code={i.code} />
            <Badge>{i.role.toLowerCase()}</Badge>
            <span className="flex-1 text-xs text-slate-500">{i.email ? `for ${i.email} · ` : ''}expires {formatDate(i.expiresAt)}</span>
            <Button size="sm" variant="ghost" title="Cancel invite" onClick={() => void api.del(`/invites/${i.id}`).then(() => queryClient.invalidateQueries({ queryKey: ['invites'] }))}>
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<Role>('CREATOR');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(14);
  const create = useMutation({
    mutationFn: () => api.post<Invite>('/invites', { role, email: email.trim() || undefined, expiresInDays: days }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  return (
    <Modal open onClose={onClose} title="Invite someone">
      {create.data ? (
        <div className="space-y-4 text-sm">
          <p>Send this code to the new team member. In Mantis they click <b>Create New User</b> and enter it.</p>
          <div className="flex items-center gap-3"><CopyCode code={create.data.code} /><Badge>{create.data.role.toLowerCase()}</Badge></div>
          <p className="text-xs text-slate-500">It works once and expires {formatDate(create.data.expiresAt)}.</p>
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Role">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Their email (optional)" hint="If set, only this email address can use the code.">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Expires after (days)">
            <input className="input w-24" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </Field>
          <ErrorText error={create.error ? errorMessage(create.error) : null} />
          <div className="flex justify-end"><Button type="submit" loading={create.isPending}>Create invite code</Button></div>
        </form>
      )}
    </Modal>
  );
}

function UserModal({ user, onClose }: { user?: TeamUser; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'CREATOR');
  const [password, setPassword] = useState('');
  const [slackUserId, setSlackUserId] = useState(user?.slackUserId ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { name, role, active, slackUserId: slackUserId || null, ...(password ? { password } : {}) })
        : api.post('/users', { name, email, role, password, slackUserId: slackUserId || undefined }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'Add person'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} /></Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label={user ? 'Reset password (optional)' : 'Temporary password'} hint="At least 8 characters. Share it with them securely.">
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={8} />
        </Field>
        <Field label="Slack member ID (optional)"><input className="input font-mono" value={slackUserId} onChange={(e) => setSlackUserId(e.target.value)} /></Field>
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (can sign in)</label>}
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

interface SystemInfo {
  jobs: string;
  storage: string;
  ai: Record<string, string>;
  local: {
    inUse: boolean;
    baseUrl: string;
    textModel: string;
    embedModel: string;
    visionModel: string | null;
    reachable: boolean;
    models: string[];
    textModelReady: boolean;
    embedModelReady: boolean;
    visionModelReady: boolean;
    error?: string;
  };
  embedDims: { expected: number; stored: number[]; mismatch: boolean };
  email: boolean;
  slack: boolean;
  publishMode: string;
  teamTimezone: string;
}

function System() {
  const { data } = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/admin/system') });
  const library = useQuery({ queryKey: ['library-server'], queryFn: () => api.get<{ library: { id: string; name: string; createdAt: string } | null; location: LibraryLocationSetting | null; lastScanAt?: string | null }>('/library') });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reindex = useMutation({ mutationFn: () => api.post('/knowledge/reindex'), onSuccess: () => setMsg('Re-index started. It runs in the background.') });
  if (!data) return <Spinner />;
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between border-b border-slate-800/60 py-2 text-sm"><span className="text-slate-400">{k}</span><span>{v}</span></div>
  );
  const ok = (b: boolean, label: string) => (b ? <Badge color="#22c55e">{label}</Badge> : <Badge>not configured</Badge>);
  return (
    <div className="space-y-6">
      <Card title="Status">
        {row('Background jobs', data.jobs === 'redis' ? 'Redis queue' : 'In-process (single server)')}
        {row('File storage', data.storage)}
        {row('Text AI', data.ai.text)}
        {row('Image AI', data.ai.image)}
        {row('Embeddings', data.ai.embeddings)}
        {row('Vision tagging', data.ai.vision)}
        {row('Image matching', data.ai.imageEmbeddings)}
        {data.local?.inUse && row('Local model server', data.local.reachable ? <Badge color="#22c55e">{data.local.baseUrl}</Badge> : <Badge color="#f43f5e">{data.local.error ?? 'unreachable'}</Badge>)}
        {data.local?.inUse && data.ai.text === 'local' && row('Text model', data.local.textModelReady ? data.local.textModel : `${data.local.textModel} is not loaded`)}
        {data.local?.inUse && data.ai.embeddings === 'local' && row('Embedding model', data.local.embedModelReady ? `${data.local.embedModel} · ${data.embedDims.expected} dimensions` : `${data.local.embedModel} is not loaded`)}
        {data.local?.inUse && data.ai.vision === 'local' && row('Vision model', data.local.visionModelReady ? (data.local.visionModel ?? 'not set') : `${data.local.visionModel ?? 'LOCAL_VISION_MODEL'} is not loaded`)}
        {data.embedDims?.mismatch && (
          <p className="mt-3 text-sm text-amber-200">
            Knowledge embeddings are stored at {data.embedDims.stored.join(' and ')} dimensions, and the current provider uses {data.embedDims.expected}. Re-index the knowledge base. Retrieval skips chunks of a different size until that finishes.
          </p>
        )}
        {row('Email (SMTP)', ok(data.email, 'configured'))}
        {row('Slack', ok(data.slack, 'configured'))}
        {row('Publishing', data.publishMode === 'ayrshare' ? 'Ayrshare' : 'Direct platform APIs')}
        {row('Team time zone', data.teamTimezone)}
        {row('Team library', library.data?.location ? `${library.data.library?.name ?? 'Library'}: ${library.data.location.uncPath ?? library.data.location.rootPath}` : 'Not set up yet')}
      </Card>
      <Card title="Maintenance">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void download('/admin/backup', 'mantis-export.json').then(() => setMsg('Export downloaded.')).catch((e) => setError(errorMessage(e)))}>
            <Download className="h-4 w-4" /> Download data export
          </Button>
          <Button variant="secondary" onClick={() => reindex.mutate()} loading={reindex.isPending}><RefreshCw className="h-4 w-4" /> Re-index knowledge base</Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">The export contains all records as JSON (no passwords or social tokens). For full disaster recovery, back up the database with pg_dump and the file storage bucket.</p>
        <p className="mt-2 text-xs text-slate-500">Re-index after changing the embedding provider or model. Existing chunks keep their old size until you do, and search ignores any size that does not match the current model.</p>
        {msg && <p className="mt-2 text-sm text-emerald-400">{msg}</p>}
        <ErrorText error={error} />
      </Card>
    </div>
  );
}
