import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, LogOut, Settings } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { FeatureHelp } from './FeatureHelp';
import { useOnboarding } from '../pages/Onboarding';
import { api, queryClient } from '../lib/api';
import { isApprovalsPath, isBrandPath, isCampaignsPath, isContentPath, isLibraryPath, isStudioPath } from '../lib/sections';
import { isManager, useSession } from '../lib/session';
import { useRealtime } from '../lib/realtime';
import { timeAgo } from '../lib/format';
import type { Notification } from '../lib/types';
import { LibraryFirstRunPrompt } from './LibraryLocation';
import { AssistantPanel } from './AssistantPanel';

/** The top bar. Studio covers the making of content. Knowledge is its own item. Settings stays on the gear. */
const NAV = [
  { to: '/', label: 'Home', active: (path: string) => path === '/' },
  { to: '/calendar', label: 'Calendar', active: (path: string) => path === '/calendar' || path.startsWith('/calendar/') },
  { to: '/tasks', label: 'Tasks', active: (path: string) => path === '/tasks' || path.startsWith('/tasks/') },
  { to: '/studio', label: 'Studio', active: isStudioPath },
  { to: '/knowledge', label: 'Knowledge', active: (path: string) => path === '/knowledge' || path.startsWith('/knowledge/') },
];

/** Reminds admins to finish the company setup wizard. */
function FinishSetupBanner() {
  const onboarding = useOnboarding();
  if (!onboarding.data || onboarding.data.state.completedAt) return null;
  return (
    <div className="mb-6 flex items-center gap-4 rounded-sm bg-chrome px-4 py-3">
      <BrandMark variant="icon" className="h-8 w-8 shrink-0" />
      <div className="flex-1">
        <div className="text-sage">Finish setting up your company</div>
        <p className="text-sm text-mist/75">Teach Mantis your company, brand kit and voice so every post sounds like you.</p>
      </div>
      <Link to="/onboarding" className="rounded-sm bg-sage px-3.5 py-2 text-sm text-mist hover:bg-sage/90">Continue setup</Link>
    </div>
  );
}

export function Layout() {
  useRealtime();
  const { user, signOut } = useSession();
  const navigate = useNavigate();
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
  const { pathname } = useLocation();
  const inStudio = isStudioPath(pathname);
  const inBrand = isBrandPath(pathname);
  const reviewCount = review.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col bg-ink text-mist">
      <header className="bg-chrome">
        <div className="flex items-center gap-6 px-6 py-4">
          <Link to="/" title="Mantis" className="shrink-0">
            <BrandMark variant="icon" className="h-9 w-9" />
          </Link>
          <div className="ml-auto flex items-center gap-1 text-sage">
            <div className="relative">
              <button onClick={() => setShowNotes((s) => !s)} className="rounded-sm p-2 hover:bg-ink/60" title="Notifications">
                <Bell className="h-4 w-4" />
                {unread > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
              {showNotes && (
                <div className="card absolute right-0 z-40 mt-2 w-96">
                  <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
                    <span className="text-sm text-sage">Notifications</span>
                    <button className="text-xs text-accent hover:underline" onClick={() => markRead.mutate()}>Mark all read</button>
                  </div>
                  <div className="max-h-96 overflow-auto">
                    {(notes.data ?? []).length === 0 && <p className="p-4 text-sm text-mist/60">Nothing yet.</p>}
                    {notes.data?.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          setShowNotes(false);
                          void api.post('/notifications/read', { ids: [n.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
                          if (n.link) navigate(n.link);
                        }}
                        className={`block w-full border-b border-white/5 px-4 py-3 text-left hover:bg-ink/50 ${n.readAt ? 'opacity-60' : ''}`}
                      >
                        <div className="text-sm text-mist">{n.title}</div>
                        {n.body && <div className="mt-0.5 text-xs text-mist/70">{n.body}</div>}
                        <div className="mt-1 text-[11px] text-mist/50">{timeAgo(n.createdAt)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <NavLink to="/settings" title="Settings" className="rounded-sm p-2 hover:bg-ink/60"><Settings className="h-4 w-4" /></NavLink>
            <button onClick={() => void signOut()} title={user ? `${user.name} · sign out` : 'Sign out'} className="rounded-sm p-2 hover:bg-ink/60">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/10 px-6">
          {NAV.map(({ to, label, active }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={`border-b py-2.5 text-xs uppercase tracking-[0.14em] ${active(pathname) ? 'border-sage text-sage' : 'border-transparent text-mist/80 hover:text-mist'}`}
            >
              {label}
            </NavLink>
          ))}
          <div className="ml-auto flex items-center">
            <FeatureHelp />
          </div>
        </nav>
        {inStudio && (
          <nav className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/5 px-6 pl-10">
            <SectionLink to="/studio" label="Content" active={isContentPath(pathname)} />
            <SectionLink to="/campaigns" label="Campaigns" active={isCampaignsPath(pathname)} />
            <SectionLink to="/approvals" label="Approvals" active={isApprovalsPath(pathname)} badge={reviewCount} />
            <SectionLink to="/library" label="Library" active={isLibraryPath(pathname)} />
            <SectionLink to="/brand-kit" label="Brand" active={inBrand} />
          </nav>
        )}
        {inBrand && (
          <nav className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/5 px-6 pl-16">
            <SectionLink to="/brand-kit" label="Brand kit" active={pathname === '/brand-kit' || pathname.startsWith('/brand-kit/')} />
            <SectionLink to="/products" label="Products" active={pathname === '/products' || pathname.startsWith('/products/')} />
            <SectionLink to="/knowledge" label="Knowledge" active={pathname === '/knowledge' || pathname.startsWith('/knowledge/')} />
            <SectionLink to="/analytics" label="Analytics" active={pathname === '/analytics' || pathname.startsWith('/analytics/')} />
          </nav>
        )}
      </header>
      <main className={`min-h-0 flex-1 overflow-auto px-8 ${isLibraryPath(pathname) ? 'pb-6 pt-0' : 'py-6'}`}>
        <FinishSetupBanner />
        <LibraryFirstRunPrompt />
        <Outlet />
      </main>
      <AssistantPanel />
    </div>
  );
}

/** A row under Studio. The count is the manager review queue, shown only when there is something waiting. */
function SectionLink({ to, label, active, badge = 0 }: { to: string; label: string; active: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      className={`border-b py-2 text-[11px] uppercase tracking-[0.14em] ${active ? 'border-sage text-sage' : 'border-transparent text-mist/70 hover:text-mist'}`}
    >
      {label}
      {badge > 0 ? ` ${badge}` : ''}
    </NavLink>
  );
}
