import type { DesignDoc, Platform, PostAction, PostStatus, SourceKind } from '@mh/shared';

export interface UserRef {
  id: string;
  name: string;
}

export interface ActivityEvent {
  id: string;
  verb: string;
  entityType: string;
  entityId: string;
  summary: string;
  link: string | null;
  createdAt: string;
  actor: UserRef | null;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  stageId: string;
  order: number;
  dueDate: string | null;
  active: boolean;
  assigneeId: string | null;
  assignee: UserRef | null;
  creator: UserRef;
  categories: Category[];
}

export interface DesignRef {
  id: string;
  name?: string;
  previewKey: string | null;
  canvaDesignId?: string | null;
}

export interface AiWarning {
  code: string;
  message: string;
}

export interface Variant {
  id: string;
  platform: Platform;
  body: string;
  aiWarnings?: AiWarning[];
  designId: string | null;
  design: DesignRef | null;
  status: 'PENDING' | 'POSTED' | 'FAILED';
  externalUrl: string | null;
  error: string | null;
  attempts: number;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  aiWarnings?: AiWarning[];
  platforms: Platform[];
  perPlatformFiles: boolean;
  status: PostStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  reviewNote: string | null;
  creatorId: string;
  creator: UserRef;
  reviewer: UserRef | null;
  campaign: { id: string; name: string } | null;
  design: DesignRef | null;
  variants: Variant[];
  createdAt: string;
}

export interface PostDetail extends Post {
  actions: PostAction[];
  editable: boolean;
  history: ActivityEvent[];
}

export interface Asset {
  id: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
  thumbnailKey: string | null;
  storedKey: string | null;
  description: string;
  tags: string[];
  needsTagging: boolean;
  /** Grayed in the library. AI tagging, matching, and generated graphics skip it. */
  notForPublicUse: boolean;
  products: { productId: string; similarity: number; confirmed: boolean | null; product: { id: string; name: string } }[];
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  features: string[];
  url: string;
  pricing: string;
  /** How the product is used. */
  usage: string;
  /** Every part number. The first is also sku. */
  partNumbers: string[];
  links: string[];
  active: boolean;
  _count?: { assets: number };
}

export interface KnowledgeSource {
  id: string;
  url: string | null;
  kind: SourceKind;
  title: string;
  status: 'PENDING' | 'OK' | 'ERROR';
  error: string | null;
  recrawlDays: number | null;
  lastCrawledAt: string | null;
  createdAt: string;
  productId: string | null;
  platform: string | null;
}

export interface MarketLink {
  id: string;
  productId: string | null;
  name: string;
  role: 'COMPETITOR' | 'PARTNER';
  url: string;
  channel: string;
}

export interface Design {
  id: string;
  name: string;
  doc: DesignDoc;
  previewKey: string | null;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  brief: string;
  startDate: string;
  endDate: string;
  platforms: Platform[];
  status: 'GENERATING' | 'READY' | 'FAILED';
  error: string | null;
  createdBy: UserRef;
  createdAt: string;
  statusCounts?: Partial<Record<PostStatus, number>>;
  _count?: { posts: number };
  posts?: Post[];
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface QuickLink {
  id: string;
  label: string;
  url: string;
  userId: string | null;
}
