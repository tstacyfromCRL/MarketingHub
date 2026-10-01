import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSession } from './lib/session';
import { Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { CalendarPage } from './pages/Calendar';
import { TasksPage } from './pages/Tasks';
import { StudioPage } from './pages/Studio';
import { DesignEditorPage } from './pages/DesignEditor';
import { PostDetailPage } from './pages/PostDetail';
import { CampaignsPage, CampaignDetailPage, NewCampaignPage } from './pages/Campaigns';
import { ApprovalsPage } from './pages/Approvals';
import { LibraryPage } from './pages/Library';
import { KnowledgePage } from './pages/Knowledge';
import { WorkLogPage } from './pages/WorkLog';
import { AnalyticsPage } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { SearchPage } from './pages/Search';
import { ContentDocPage } from './pages/ContentDoc';
import { OnboardingPage } from './pages/Onboarding';
import { BrandKitPage } from './pages/BrandKit';
import { ProductsPage } from './pages/Products';

export function App() {
  const { ready, user, init } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    void init();
  }, [init]);

  // Deep links (marketinghub://posts/123) from emails and Slack messages.
  useEffect(() => {
    if (!user) return;
    void window.api.app.takeDeepLink().then((r) => r && navigate(r));
    return window.api.app.onNavigate((route) => navigate(route));
  }, [user, navigate]);

  if (!ready) return <Spinner label="Starting Marketing Hub..." />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route path="onboarding" element={<OnboardingPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<TasksPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="content/:id" element={<ContentDocPage />} />
        <Route path="designs/new" element={<DesignEditorPage />} />
        <Route path="designs/:id" element={<DesignEditorPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/new" element={<NewCampaignPage />} />
        <Route path="campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="knowledge/*" element={<KnowledgePage />} />
        <Route path="brand-kit" element={<BrandKitPage />} />
        <Route path="products/*" element={<ProductsPage />} />
        <Route path="activity" element={<WorkLogPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
