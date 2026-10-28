# Task: Build the knowledge infrastructure for Marketing Hub

Read `docs/AI_ARCHITECTURE.md` first. This task adds a structured knowledge system on top of the existing knowledge code (`packages/core/src/knowledge.ts`, `generation.ts`, `KnowledgeChunk` + pgvector) and the existing AI providers (`mock | openai | anthropic | local`).

Follow existing repo patterns:
- zod schemas in `@mh/shared`
- Prisma migrations in `packages/db`
- jobs registered in `queue.ts` `JobPayloads` + `jobs.ts` `jobHandlers`
- `recordEvent()` for activity
- `requireRole('MANAGER')` for admin routes

Keep the `mock` AI provider working everywhere. Never read, print or commit `.env`; add new variables to `config.ts` and `.env.example` only.

Work in the phases below, in order. At the end of each phase: run `pnpm db:generate`, `pnpm typecheck` and `pnpm test`, then stop and summarize what changed before continuing.

## Core idea

Knowledge comes in four types, and each is used differently:
1. **Brand rules** (voice, always/never rules, audience, tagline, visual direction) → `BrandProfile`. Included in EVERY prompt. Not dependent on search.
2. **Playbooks** (per-platform and per-content-type writing instructions, hashtag ranges, length, content pillars) → new `PromptTemplate` table. Selected by platform + content type, never by search.
3. **Facts** (products, approved claims/stats, accomplishments, web pages, documents) → retrieved per brief through the knowledge search.
4. **Style examples** (approved past posts) → `Source(kind=SAMPLE_POST)`, used for tone only, never as a source of facts.

Every fact has one owner that the app syncs from: a product connector (Shopify first), the website crawler, uploaded documents, or a version-controlled **knowledge pack** folder imported into the app.

## Tenancy-ready, not multi-tenant

This app is used by one company today but may be offered to other companies later. **Do not build multi-tenancy now**: no org switcher, no org sign-up, no billing, no per-org user management, no cross-org security work. Just avoid design choices that would force a rewrite later:

- There is exactly one `Organization` row (the default org). Code passes its ID around instead of assuming a global singleton.
- No company-specific content in code. Seeds and defaults stay generic. All Carnegie Robotics content arrives through a knowledge pack.
- Content pillars, content types and platform guidance are **data** (`PromptTemplate` rows), never enums or hard-coded strings.
- Integrations sit behind small interfaces, so Shopify is one option rather than an assumption.

The phases below say exactly where this applies. Where a rule would need significant extra work outside this task's scope, leave a `// TENANCY:` comment instead of building it.

---

## Phase A — Schema

Add a Prisma migration with:

- **Organization:** `Organization { id, name, slug @unique, createdAt }`. Seed one default org (name from `BrandProfile.companyName` if set, else "Default"). Add `getDefaultOrgId()` in core (cached).
- **Org ownership:**
  - Add `organizationId` (relation to `Organization`, backfilled to the default org) to every NEW table in this task and to `BrandProfile`, `Product`, `Accomplishment`, `Source` and `KnowledgeChunk`.
  - Leave other existing tables (users, posts, campaigns, assets, tasks, etc.) alone for now and mark them with a `// TENANCY:` comment in the schema.
- **BrandProfile:** change the hard-coded `id: 'brand'` singleton to "the brand profile for org X" (`organizationId @unique`). Update `brandProfile()` in `knowledge.ts` and the upsert in `onboarding.ts` accordingly.
- **Sensitivity:** add `enum Sensitivity { PUBLIC INTERNAL RESTRICTED }` and `sensitivity Sensitivity @default(PUBLIC)` on `Source`, `Product`, `Accomplishment` and `KnowledgeChunk`. `embedKnowledge()` copies the parent's sensitivity onto its chunks. Content marked RESTRICTED is never embedded.
- **Import keys:** add `externalKey String?` and `origin String @default("manual")` (`manual | seed | pack | connector | crawl | upload | watch`) to `Product`, `Accomplishment` and `Source`, with `@@unique([organizationId, externalKey])`.
- **Change detection:** add `contentHash String?` to `Product`, `Accomplishment`, `Source`, `Claim` and `PromptTemplate`, so unchanged items are skipped and not re-embedded.
- **New `PromptTemplate`:**
  `id, organizationId, externalKey, name, platform String?, contentType String?, pillar String?, body String (the instructions), hashtagMin Int?, hashtagMax Int?, maxChars Int?, version Int @default(1), active Boolean @default(true), origin, contentHash, updatedAt`, with `@@unique([organizationId, externalKey])`.
- **New `Claim`** (approved public statements and stats):
  `id, organizationId, externalKey, text String, sourceUrl String @default(""), asOf DateTime?, expiresAt DateTime?, status String @default("APPROVED") (APPROVED | RETIRED), productIds String[], sensitivity, origin, contentHash, createdAt, updatedAt`, with `@@unique([organizationId, externalKey])`.
- **New `ConfidentialTerm`** (names the AI must never write — customers, partners, programs under NDA):
  `id, organizationId, term String, aliases String[], note String @default(""), createdAt`, with `@@unique([organizationId, term])`.
- **New `IntegrationSetting`** (per-org integration config):
  `id, organizationId, connectorId String, enabled Boolean @default(false), configEncrypted String, updatedAt`, with `@@unique([organizationId, connectorId])`. Encrypt with the existing `crypto.ts` / `ENCRYPTION_KEY`.
- **Other changes:**
  - Add `DOCUMENT` to `enum SourceKind`.
  - Add `pillar String?` to `Campaign` and `Post`.
  - Add `aiWarnings Json @default("[]")` to `Post` and `PostVariant`. If a `Generation` table from spec Phase 1 exists, also add `warnings Json` there.

Write the migration so existing data is preserved: backfill `organizationId` and convert the existing `'brand'` row.

## Phase B — Knowledge pack format and importer

Define zod schemas in `packages/shared/src/knowledgePack.ts` for this folder layout:

```
knowledge-pack/
  manifest.json            { schemaVersion: 1, name, updatedAt }
  brand.json               BrandProfile fields: companyName, summary, tagline, mission, audience, voice, visualIdentity, dos[], donts[], colors[], fonts[], website
  playbooks/*.json         { key, name, platform?, contentType?, pillar?, body, hashtagMin?, hashtagMax?, maxChars? }
  products.json            [{ key, name, sku?, description, features[], pricing?, url?, links[], sensitivity? }]
  claims.json              [{ key, text, sourceUrl?, asOf?, expiresAt?, productKeys[]?, sensitivity? }]
  accomplishments.json     [{ key, title, description, date?, sensitivity? }]
  sources.json             [{ key, url, kind, recrawlDays?, sensitivity? }]   // pages to crawl
  confidential.json        [{ term, aliases[], note? }]
  examples/*.md            frontmatter: { key, platform, pillar?, contentType? } + body = an approved past post
  documents/*.(md|txt|pdf|docx)   reference documents; frontmatter or sidecar <file>.meta.json for sensitivity
```

The pack is the **portable unit of a company's knowledge**. It contains no org IDs, and importing it into an org fills that org's knowledge.

Implement `importKnowledgePack(orgId, dir, { dryRun, prune })` in `packages/core/src/knowledgePack.ts`:
- Validate everything with zod first. On any error, fail with file and field paths and change nothing.
- Upsert by `(organizationId, externalKey = "pack:<key>")`. Brand is one row per org. Compare `contentHash` and skip unchanged items.
- Map: examples → `Source(kind=SAMPLE_POST, platform)`; sources → `Source` + enqueue `scrape-source`; documents → `Source(kind=DOCUMENT)` with extracted text; claims → `Claim`; playbooks → `PromptTemplate`.
- Enqueue `embed-knowledge` only for items that were created or changed. Claims are embedded with `sourceType = 'CLAIM'` (extend `KnowledgeSourceType` and `textFor()`).
- `prune: true` removes or deactivates only items with `origin = "pack"` in that org that are missing from the pack. Never touch other origins.
- Return a report `{ created, updated, unchanged, removed, warnings }` per entity type. `dryRun` returns the report and writes nothing.
- Wrap all writes in a transaction where practical.

Also add `exportKnowledgePack(orgId, dir)`, which writes the org's current state back out in the same format (round-trip).

Entry points (use the default org for now):
- CLI: root scripts `pnpm kb:import <dir> [--dry-run] [--prune]` and `pnpm kb:export <dir>`.
- API (manager only): `POST /knowledge/pack/import` (zip upload, `dryRun` query param) and `GET /knowledge/pack/export` (zip download).
- Log each import with `recordEvent`.

Create `knowledge-pack.example/` with a small, obviously fictional company ("Acme Field Robotics") covering every file type. It's used in tests and as documentation. Do NOT invent real Carnegie Robotics content; the real pack will be supplied separately.

Text extraction for documents: md/txt as is, PDF with `pdf-parse`, DOCX with `mammoth`. Put this in a shared `extractText(buffer, mime)` helper, which Phase E reuses.

New files written to storage by this task use keys prefixed `orgs/<orgId>/...`. Existing storage keys stay as they are.

## Phase C — Prompt assembly

Core functions touched in this phase take an `orgId` (or a small `{ orgId }` context) instead of assuming one company: `buildBrandContext`, `retrieve`, `selectPlaybook`, `generateContent`, `adaptCopyForPlatforms`, `generatePostIdeas`. `retrieve()` filters by `organizationId`. Callers pass `getDefaultOrgId()` for now. Every `JobPayloads` entry added or changed in this task includes `orgId`.

Update `packages/core/src/generation.ts`:
- **Playbook selection:** `selectPlaybook(orgId, platform, contentType, pillar?)` picks the most specific active `PromptTemplate` (platform+type+pillar → platform+type → type → fallback). Seed the current `TYPE_INSTRUCTIONS` strings as generic default templates (`origin: "seed"`) so nothing breaks when no pack has been imported. Then remove `TYPE_INSTRUCTIONS` from code.
- `generateContent` uses the selected playbook's `body` in place of the hard-coded instruction. Hashtag range and max length come from the playbook, falling back to `PLATFORM_PRESETS`. The hard-coded "2-5 hashtags" in the current instructions moves into the seed template only.
- `adaptCopyForPlatforms` includes each platform's playbook instructions and hashtag range in the prompt, per platform, replacing the hard-coded "LinkedIn professional, X concise, Instagram visual" hint.
- `generatePostIdeas` accepts an optional `pillar` (from `Campaign.pillar`) and includes the pillar's playbook guidance. Its list of angles also moves into a seed template.
- **Claims:** add an "Approved claims" block to the prompt, using retrieved `CLAIM` chunks plus all claims linked to selected products. Only `status = APPROVED` claims that haven't expired. Instruction: *"Only use numbers, statistics, customer results and awards that appear in Approved claims or Company knowledge. If none fit, write without them."*
- **Confidential terms:** add to the system prompt: *"Never mention these names in any output: …"* (terms + aliases).
- **Sensitivity:** if the text provider is `openai` or `anthropic`, drop chunks marked INTERNAL from the prompt and record that this happened (spec §6). INTERNAL content may only be used with the `local` provider.

## Phase D — Output validator

Add `packages/core/src/ai/validate.ts`, with `validateOutput(text, { platform, playbook, facts, claims, confidentialTerms, donts })` returning a list of warnings. It is a pure function: no DB access, no org assumptions.
- A confidential term or alias appears (case-insensitive, word boundaries) → `CONFIDENTIAL_TERM`.
- A number, percentage, dollar amount or "Nx" multiplier that doesn't appear in the provided facts or claims → `UNSUPPORTED_NUMBER`. Ignore years, dates, list numbering and numbers in product names or SKUs.
- Hashtag count outside the playbook range → `HASHTAG_COUNT`.
- Over the platform or playbook character limit → `TOO_LONG`.
- A phrase from `donts` appears → `BRAND_DONT`.

Run it after every text generation and store the results in `aiWarnings` on the created post or variant (and `Generation.warnings` if present). These are warnings: show them, don't block generation. Return the warnings from `POST /generate/text` as well.

## Phase E — Source sync

1. **Product connector interface.**
   - Define, in `packages/core/src/connectors/`:
     ```ts
     interface ProductSourceConnector {
       id: string;                 // 'shopify' | 'csv' | ...
       displayName: string;
       configSchema: z.ZodTypeAny; // validated, stored encrypted in IntegrationSetting
       fetchProducts(config): AsyncIterable<NormalizedProduct>;
     }
     ```
   - Add a small registry. The job `sync-products { orgId }` loads the org's enabled `IntegrationSetting`s and runs each connector.
   - Upsert `Product` by `(organizationId, externalKey = "<connectorId>:<externalId>")`, `origin = "connector"`. Products missing or archived at the source → `active = false`.
   - Re-embed only products whose content changed.
   - Runs daily (add to `REPEATING_JOBS`, which enqueues for the default org) plus a manual "Sync now" route for managers.
2. **Shopify connector (first implementation).**
   - Config: `{ storeDomain, adminToken, apiVersion }`, stored in `IntegrationSetting`. If no setting exists, fall back to env `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_API_VERSION` for the default org only.
   - Use the Admin GraphQL API with pagination: title, handle, descriptionHtml (convert to plain text), status, tags, onlineStoreUrl, first variant's SKU and price.
   - Put the GraphQL-response → `NormalizedProduct` mapping in a pure function and test it with a fixture.
3. **CSV/JSON connector (second implementation, proves the interface).** Products come from an uploaded CSV or JSON file with columns name, sku, description, price, url and features (semicolon-separated).
4. **Merge rule** when a pack product and a connector product share a SKU: the connector owns name, price, URL and description; the pack owns features, positioning and links. Store pack-owned fields separately so a sync never overwrites them.
5. **Website.** Pack `sources.json` entries use the existing crawler with `recrawlDays`. Confirm `recrawl-sources` picks them up and is org-aware.
6. **Documents.**
   - `POST /knowledge/documents` (multipart upload, with sensitivity) → `Source(kind=DOCUMENT, origin="upload")` with extracted text, then embed.
   - Optional `KNOWLEDGE_WATCH_DIR` env (default org only): a repeating job every 10 minutes scans the folder, hashes files, and adds, updates or removes `DOCUMENT` sources (`origin = "watch"`).

## Phase F — Desktop UI

On the Knowledge page in `apps/desktop`, add tabs or sections. Everything operates on the default org; no org picker.
- **Brand:** edit `BrandProfile`. Make sure dos and donts can be edited as lists.
- **Playbooks:** list, edit and activate `PromptTemplate`s, grouped by platform. Show which template a given platform + type + pillar would use.
- **Claims:** table with status, source link, as-of date and expiry. Approve or retire. Highlight claims expiring within 30 days.
- **Confidential terms:** add, edit and remove.
- **Products:** show an origin badge (connector name, pack, manual), last synced time and a "Sync now" button.
- **Integrations:** enable a product connector and enter its config. Secret fields are write-only: show "set" / "not set", never the value.
- **Documents:** upload, list, set sensitivity, delete.
- **Import / Export:** upload a pack zip → show a dry-run diff (created, updated, removed counts plus details) → Confirm to apply. An Export button downloads a zip.
- Show `aiWarnings` as a badge on post cards and inline in the post editor, with one line explaining each warning.

## Phase G — Tests and docs

Use vitest with the `mock` providers. Cover:
- Pack schemas accept `knowledge-pack.example/` and reject malformed files with useful paths.
- Importing the same pack twice → second report shows 0 created, 0 updated.
- `prune` removes only `origin = "pack"` items.
- Org scoping: create a second org in the test DB, import the example pack into it, and confirm `retrieve()`, `selectPlaybook()` and claims for the default org don't see the second org's data. (This is the one place a second org exists; there is no UI for it.)
- `selectPlaybook` specificity and fallback to the seeded defaults.
- The validator flags an unsupported number, a confidential term, a wrong hashtag count and a brand "don't", and does not flag years, dates or SKUs.
- The Shopify and CSV mappers, using fixtures.
- INTERNAL chunks are excluded when the provider is `openai` or `anthropic` and included with `local`.
- The migration preserves the existing brand profile and knowledge.

Add a "Knowledge system" section to `docs/AI_ARCHITECTURE.md`, including a short "Tenancy readiness" note that lists the `// TENANCY:` comments left behind. Document the pack format in `knowledge-pack.example/README.md`.

## Out of scope

- Multi-tenancy features: org sign-up, org switching, per-org users or roles, billing, per-org AI keys, tenant isolation hardening.
- Fine-tuning and engagement metrics.
- Changes to the post approval workflow.
