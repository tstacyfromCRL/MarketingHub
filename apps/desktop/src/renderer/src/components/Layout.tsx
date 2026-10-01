import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  BarChart3, Bell, BookOpen, CalendarDays, CheckCircle2, FolderOpen, History, KanbanSquare, LayoutDashboard, LogOut, Megaphone, Package, Palette, PenTool,
  Search, Settings, Sparkles,
} from 'lucide-react';
import { useOnboarding } from '../pages/Onboarding';
import { api, queryClient } from '../lib/api';
import { isManager, useSession } from '../lib/session';
import { useRealtime } from '../lib/realtime';
import { timeAgo } from '../lib/format';
import type { Notification } from '../lib/types';
import { LibraryFirstRunPrompt } from './LibraryLocation';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: KanbanSquare },
  { to: '/studio', label: 'Content Studio', icon: PenTool },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/approvals', label: 'Approvals', icon: CheckCircle2 },
  { to: '/library', label: 'Asset Library', icon: FolderOpen },
  { to: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { to: '/brand-kit', label: 'Brand Kit', icon: Palette },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/activity', label: 'Work Log', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Reminds admins to finish the company setup wizard. */
function FinishSetupBanner() {
  const onboarding = useOnboarding();
  if (!onboarding.data || onboarding.data.state.completedAt) return null;
  return (
    <div className="mb-6 flex items-center gap-4 rounded-lg border border-indigo-800/60 bg-indigo-950/40 p-4">
      <Sparkles className="h-5 w-5 shrink-0 text-indigo-300" />
      <div className="flex-1">
        <div className="font-medium">Finish setting up your company</div>
        <p className="text-sm text-slate-400">Teach Marketing Hub your company, brand kit and voice so every post sounds like you.</p>
      </div>
      <Link to="/onboarding" className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500">Continue setup</Link>
    </div>
  );
}

export function Layout() {
  useRealtime();
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications') });
  const review = useQuery({
    queryKey: ['posts', 'review-count'],
    queryFn: () => api.get<unknown[]>('/posts?status=CREATOR_APPROVED,IN_REVIEW'),
    enabled: isManager(user),
  });
  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = notes.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <div className="px-5 py-5">
          <div className="text-lg font-bold tracking-tight">Marketing Hub</div>
          <div className="text-xs text-slate-500">{user?.name} · {user?.role.toLowerCase()}</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-indigo-600/20 text-indigo-200' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {to === '/approvals' && (review.data?.length ?? 0) > 0 && (
                <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-semibold text-white">{review.data!.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => void signOut()} className="m-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-900 hover:text-slate-300">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-3">
          <form
            className="relative max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input className="input pl-9" placeholder="Search posts, tasks, products, assets..." value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setShowNotes((s) => !s)} className="relative rounded-md p-2 text-slate-400 hover:bg-slate-900">
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            {showNotes && (
              <div className="card absolute right-0 z-40 mt-2 w-96 shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                  <span className="text-sm font-semibold">Notifications</span>
                  <button className="text-xs text-indigo-300 hover:underline" onClick={() => markRead.mutate()}>Mark all read</button>
                </div>
                <div className="max-h-96 overflow-auto">
                  {(notes.data ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">Nothing yet.</p>}
                  {notes.data?.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setShowNotes(false);
                        void api.post('/notifications/read', { ids: [n.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
                        if (n.link) navigate(n.link);
                      }}
                      className={`block w-full border-b border-slate-800/60 px-4 py-3 text-left hover:bg-slate-800/50 ${n.readAt ? 'opacity-60' : ''}`}
                    >
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <div className="mt-0.5 text-xs text-slate-400">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-slate-500">{timeAgo(n.createdAt)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto px-8 py-6">
          <FinishSetupBanner />
          <LibraryFirstRunPrompt />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
