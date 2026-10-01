import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PostAction } from '@mh/shared';
import { api } from '../lib/api';
import { isManager, useSession } from '../lib/session';
import type { Post } from '../lib/types';
import { PageHeader, Spinner, Tabs } from '../components/ui';
import { PostTable } from '../components/PostTable';

type Tab = 'review' | 'drafts' | 'scheduled' | 'failed' | 'posted';

const QUERIES: Record<Tab, string> = {
  review: 'status=CREATOR_APPROVED,IN_REVIEW',
  drafts: 'status=DRAFT&mine=1',
  scheduled: 'status=SCHEDULED',
  failed: 'status=FAILED',
  posted: 'status=POSTED',
};

export function ApprovalsPage() {
  const { user } = useSession();
  const manager = isManager(user);
  const [tab, setTab] = useState<Tab>(manager ? 'review' : 'drafts');
  const { data, isLoading } = useQuery({ queryKey: ['posts', tab], queryFn: () => api.get<Post[]>(`/posts?${QUERIES[tab]}`) });

  const bulk: Record<Tab, PostAction[]> = {
    review: manager ? ['startReview'] : [],
    drafts: ['creatorApprove'],
    scheduled: manager ? ['unschedule'] : [],
    failed: manager ? ['retry', 'unschedule'] : [],
    posted: [],
  };

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Creator approval → manager review → scheduled → posted." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          ...(manager ? [{ id: 'review' as const, label: 'Awaiting manager review' }] : []),
          { id: 'drafts', label: 'My drafts' },
          { id: 'scheduled', label: 'Scheduled' },
          { id: 'failed', label: 'Failed' },
          { id: 'posted', label: 'Posted' },
          ...(!manager ? [{ id: 'review' as const, label: 'In review' }] : []),
        ]}
      />
      {tab === 'review' && manager && <p className="mb-3 text-sm text-slate-400">Open a post to edit it, return it to the creator with notes, or approve and schedule it.</p>}
      {isLoading ? <Spinner /> : <PostTable posts={data ?? []} bulkActions={bulk[tab]} empty="Nothing here right now." />}
    </div>
  );
}
