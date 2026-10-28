# Marketing Hub — Local AI Architecture Spec

**Status:** Draft v1 · 2026-10-01
**Audience:** Developers (and Cursor) working in this repo
**Goal:** Let Marketing Hub run its text AI on a local open-weight model on an NVIDIA GPU, get more Carnegie Robotics–specific over time from the team's own approvals and edits, and keep sensitive material off third-party APIs.

> **For Cursor:** Implement this one phase at a time, in order. Each phase lists files to touch, schema changes and acceptance criteria. Don't start a phase until the previous one's acceptance criteria pass, `pnpm typecheck` passes and `pnpm test` passes. Keep the existing `mock` provider working in every phase: it's how dev and tests run without a GPU or API keys.

---

## 1. Principles

1. **Customize the model, don't build one.** We don't pretrain. We run an existing open-weight instruct model and adapt it in three layers, in order of cost:
   - **Prompting and brand profile.** Already exists in `buildBrandContext()`.
   - **Retrieval (RAG).** Already exists: `KnowledgeChunk` + pgvector + `retrieve()`.
   - **LoRA fine-tuning.** New. It teaches voice, structure and format from posts the team approved. It is **not** a way to store facts.
2. **Facts come from retrieval, style comes from fine-tuning.** Product specs, accomplishments and claims always come from the knowledge base at generation time, so they stay current and can be checked. Fine-tuned weights must never be the only source of a fact.
3. **"Continual learning" is a loop, not live weight updates.** Every generation is logged. Human edits and approvals become training data. New adapters are trained in batches, scored against a fixed eval set, and promoted only if they beat the current model.
4. **Provider-agnostic.** `local` becomes one more provider next to `mock | openai | anthropic`. The app must work the same way whichever is selected.
5. **Sensitive by default.** Any knowledge marked sensitive must never be sent to a cloud provider (see §6).

---

## 2. Current state (as of this spec)

What already exists and should be built on, not replaced:

| Concern | Where | Notes |
|---|---|---|
| Provider switch | `packages/core/src/ai/providers.ts` | `generateText`, `generateImage`, `embedTexts`, `describeImage`; env-driven `mock / openai / anthropic` |
| Config | `packages/core/src/config.ts` | zod-validated env; add new vars here **and** in `.env.example` |
| Brand system prompt + RAG | `packages/core/src/generation.ts` → `buildBrandContext()` | Brand profile, retrieved chunks, style examples from `Source(kind=SAMPLE_POST)` chosen by keyword overlap |
| Knowledge index | `packages/core/src/knowledge.ts` | Chunking, `embedKnowledge`, `reindexAllKnowledge`, `retrieve()` (filters by `vector_dims`, so mixed dimensions are tolerated) |
| Post workflow | `packages/shared/src/postWorkflow.ts`, `packages/core/src/posts.ts` | DRAFT → CREATOR_APPROVED → IN_REVIEW → SCHEDULED → POSTED/FAILED; `returnToCreator` carries a `reviewNote` |
| Jobs | `packages/core/src/queue.ts`, `jobs.ts` | BullMQ (or in-process without Redis); add new jobs to `JobPayloads` + `jobHandlers` |
| DB | `packages/db/prisma/schema.prisma` | Postgres + pgvector (docker), PGlite in dev |

**Gaps this spec closes:**

- No local model provider.
- **AI output isn't logged.** `Post.body` is overwritten on edit, so we can't tell what the model wrote from what a human changed. That comparison is the main training signal, and today it's lost.
- Style examples are only manually pasted `SAMPLE_POST`s. Approved and posted content never feeds back in.
- No engagement metrics are stored.
- No model versioning or evaluation.
- No way to mark knowledge as sensitive.

---

## 3. Target architecture

```
┌──────────────────────────┐      HTTP/WS       ┌───────────────────────────────┐
│ apps/desktop (Electron)  │ ─────────────────▶ │ apps/server (Fastify)         │
│  UI only, no model here  │                    │  routes → @mh/core            │
└──────────────────────────┘                    └──────────────┬────────────────┘
                                                               │ BullMQ
                                                ┌──────────────▼────────────────┐
                                                │ apps/worker                   │
                                                │  generation, embeddings,      │
                                                │  metrics, dataset export      │
                                                └──────────────┬────────────────┘
                         OpenAI-compatible HTTP                │
             ┌─────────────────────────────────────────────────┤
             ▼                                                 ▼
┌───────────────────────────┐                    ┌──────────────────────────────┐
│ Inference server (GPU box)│                    │ Postgres + pgvector          │
│  Ollama (start) or vLLM   │                    │  KnowledgeChunk, Generation, │
│  base model + LoRA adapter│                    │  ModelVersion, PostMetric…   │
│  embedding model          │                    └──────────────────────────────┘
└─────────────▲─────────────┘
              │ GGUF / adapter files
┌─────────────┴─────────────┐
│ ml/ (Python, offline)     │
│  dataset → QLoRA train →  │
│  eval → export → register │
└───────────────────────────┘
```

**Key decision:** the model is **not** bundled into the Electron app. It runs as a separate inference service on the NVIDIA machine, and the server and worker reach it over an OpenAI-compatible HTTP API. Benefits:

- Every team member's desktop app gets the same model and adapter.
- Installers stay small.
- Swapping Ollama for vLLM, or moving to a bigger GPU, is just a URL change.

### 3.1 Inference server

- **Start with Ollama.** It's the simplest setup on Windows, serves GGUF models, exposes `/v1/chat/completions` and `/v1/embeddings`, and loads LoRA adapters through a `Modelfile` (`ADAPTER`) or a merged GGUF.
- **Move to vLLM** (Linux or WSL2) if several people generating at once is too slow. vLLM batches requests and can hot-load LoRA adapters per request.
- Run it on the GPU box as a service and bind it to the LAN only. Never expose it to the internet.

### 3.2 Model selection (decide in Phase 0, revisit each quarter)

Choose a current **7B–14B instruct model** from an established open-weight family (Qwen, Llama, Gemma, Mistral). Before committing, check two things:

- **License allows commercial use.** Several families are Apache-2.0. Llama and Gemma have their own terms. Get sign-off.
- **Base quality on our eval set** (Phase 3). Pick the best scorer that fits the VRAM budget below.

Rough VRAM budget at 4-bit quantization:

| Model size | Inference (Q4) | QLoRA training |
|---|---|---|
| 7–8B | ~6–8 GB | ~12–16 GB |
| 12–14B | ~10–12 GB | ~20–24 GB |
| ~30B | ~20–24 GB | 40 GB+ (rent a cloud GPU) |

Embeddings: a local embedding model served by the same Ollama instance (e.g. `nomic-embed-text`, `bge-m3` or `mxbai-embed-large`). Record its name and dimension in config.

---

## 4. Phases

### Phase 0 — Local provider (text + embeddings)

**Goal:** `AI_TEXT_PROVIDER=local` and `AI_EMBED_PROVIDER=local` work end to end against Ollama.

**Config** (`config.ts` + `.env.example`):
```
AI_TEXT_PROVIDER=mock|openai|anthropic|local
AI_EMBED_PROVIDER=mock|openai|local
AI_VISION_PROVIDER=mock|openai|anthropic|local   # optional; only if a local vision model is chosen
LOCAL_LLM_BASE_URL=http://gpu-box:11434/v1
LOCAL_LLM_API_KEY=                 # blank for Ollama; set for vLLM if --api-key used
LOCAL_TEXT_MODEL=<ollama tag, e.g. mh-writer:latest>
LOCAL_EMBED_MODEL=<ollama tag>
LOCAL_EMBED_DIMS=<int>
LOCAL_LLM_TIMEOUT_MS=120000
```

**Code (`providers.ts`):**
- Refactor `openAiChat` into `openAiCompatibleChat({ baseUrl, apiKey, model, ... })` and use it for both `openai` and `local`.
- For `local`, send `max_tokens` instead of `max_completion_tokens`. Not every OpenAI-compatible server accepts the newer field, so verify against the server you chose.
- `response_format: { type: 'json_object' }` is supported by Ollama and vLLM. Keep calling `extractJson()` on the result anyway, because small models sometimes wrap JSON in prose.
- Add an `AbortSignal.timeout(LOCAL_LLM_TIMEOUT_MS)` to local calls.
- Add `local` to `embedTexts()` using `/v1/embeddings`.
- Every provider call returns `{ text, provider, model, usage? }` internally so Phase 1 can log it. Keep the public `generateText()` signature returning `string` for now, and add `generateTextDetailed()` alongside it.

**Admin:**
- Add a health check that `GET {LOCAL_LLM_BASE_URL}/models` succeeds and shows the configured model. Show it in the existing admin routes and UI.
- Switching the embed provider requires running the existing `reindex-knowledge` job. Show a warning in the UI when the stored chunk dimension ≠ the current embed dimension.

**Acceptance:**
- [ ] With Ollama running and `local` selected, generating a social post, an email and a campaign (`generatePostIdeas`, which uses JSON mode) all succeed.
- [ ] `reindex-knowledge` repopulates embeddings at `LOCAL_EMBED_DIMS`, and `retrieve()` returns relevant chunks.
- [ ] `mock`, `openai` and `anthropic` still work unchanged.
- [ ] Unit test for the request/response mapping of the local provider (mock `fetch`).

---

### Phase 1 — Generation log + feedback capture (the training data)

**Goal:** Every AI call is recorded, and every human outcome (edit, approve, reject, publish) is linked back to it. This is the most important phase. Without it there's nothing to learn from.

**Schema (new):**
```prisma
model Generation {
  id              String   @id @default(cuid())
  kind            String   // SOCIAL_POST | EMAIL | BLOG | DOCUMENTATION | PLATFORM_ADAPT | POST_IDEAS | OTHER
  platform        String?
  provider        String   // mock | openai | anthropic | local
  model           String
  modelVersionId  String?  // Phase 5
  system          String   // full system prompt as sent
  prompt          String   // full user prompt as sent
  output          String   // raw model output
  retrievedChunkIds String[]
  styleExampleIds String[]
  latencyMs       Int?
  promptTokens    Int?
  outputTokens    Int?
  createdById     String?
  createdAt       DateTime @default(now())
  feedback        GenerationFeedback[]
  @@index([kind, createdAt])
}

model GenerationFeedback {
  id            String   @id @default(cuid())
  generationId  String
  generation    Generation @relation(fields: [generationId], references: [id], onDelete: Cascade)
  postId        String?
  variantId     String?
  type          String   // EDITED | CREATOR_APPROVED | RETURNED | APPROVED | PUBLISHED | DISCARDED | RATED
  finalText     String?  // text at the time of this event
  note          String?  // reviewNote, or free-text from a thumbs-down
  rating        Int?     // -1 | 1 from in-app thumbs
  editDistance  Float?   // normalized Levenshtein(output, finalText), 0..1
  actorId       String?
  createdAt     DateTime @default(now())
  @@index([generationId])
  @@index([type, createdAt])
}
```
Add `generationId String?` to `Post` and `PostVariant`, and `aiOriginalBody String?` to both. `aiOriginalBody` is set once, when a post is created from AI output, and never overwritten.

**Code:**
- New `packages/core/src/ai/log.ts` with `logGeneration(...)`, called from inside `generateContent`, `adaptCopyForPlatforms` and `generatePostIdeas`. Return `generationId` to callers. Don't log `mock` output in production builds.
- `POST /generate/text` returns `{ text, generationId }`. The desktop UI keeps `generationId` and sends it when a post or content doc is created from that text.
- In `applyPostAction()` (`posts.ts`), write `GenerationFeedback` for `creatorApprove`, `returnToCreator` (with the note), `approve` and `publishSucceeded`, using the current post or variant body as `finalText`.
- In the post update route, write an `EDITED` feedback row when `body` or a variant body changes. Debounce to at most one row per post per 10 minutes.
- Desktop: add 👍/👎 on every AI result, plus an optional "what's wrong?" text box → `RATED`.
- Store `editDistance` so we can track "how much do humans have to fix the AI?" over time. This is the headline quality metric.

**Acceptance:**
- [ ] Generating a post, editing it, and approving it through to POSTED leaves one `Generation` row and ≥3 `GenerationFeedback` rows that all link correctly.
- [ ] `aiOriginalBody` still holds the original AI text after edits.
- [ ] Admin page shows average edit distance by week and by `kind`.

---

### Phase 2 — Better retrieval and approved-content style examples

**Goal:** Improve output before any fine-tuning. This phase is cheap and usually gives the largest quality gain.

1. **Approved posts become style examples.** Extend `styleExamples()` to draw from `Post` / `PostVariant` with status `POSTED` (plus manual `SAMPLE_POST`s), weighted toward low `editDistance` and, after Phase 6, high engagement.
2. **Choose examples by embedding similarity** instead of word overlap. Embed approved post bodies into `KnowledgeChunk` with a new `sourceType = 'APPROVED_POST'`. Exclude these from the facts block, the same way `SAMPLE_POST`s are already excluded.
3. **Retrieval quality:**
   - Hybrid search: pgvector cosine plus Postgres full-text (`ts_rank`), merged with reciprocal rank fusion. Product names and SKUs match much better with keywords.
   - Optional: a local reranker (cross-encoder) on the top 30 → keep 8.
   - Store a `retrievedChunkIds` score breakdown in `Generation` for debugging.
4. **Industry knowledge.** Add `SourceKind` values or tags for `INDUSTRY` (standards, market and competitor material) and `CAMPAIGN` (messaging docs such as *Proven Autonomy for Any Platform*). Let a campaign pin specific sources so they always appear in its context.
5. **Prompt templates as data.** Move `TYPE_INSTRUCTIONS` and the platform conventions into a `PromptTemplate` table, editable by managers in the UI, with `version`. Record the template version in `Generation`. Keep the current strings as seed defaults.

**Acceptance:**
- [ ] After 10 posts reach POSTED, new generations for the same platform include them as style examples.
- [ ] A query containing an exact product name or SKU returns that product's chunk in the top 3.
- [ ] Eval score (Phase 3) is ≥ the Phase 0 baseline.

---

### Phase 3 — Evaluation harness

**Goal:** Every change to a model, prompt or retrieval setting gets an objective score before release.

- `packages/core/src/ai/eval/` with a fixed **eval set**: 40–80 briefs covering each `ContentType`, each platform, each product line, and a few tricky cases (asks for a stat we don't have, asks about a competitor, defense-adjacent topic). Store it as JSON in the repo: `eval/cases.json`.
- **Automatic checks** (pure TS, run in CI with `mock`):
  - Platform character limit respected (`PLATFORM_PRESETS`).
  - Hashtag count within 2–5 for social.
  - No phrases from `BrandProfile.donts`.
  - No numbers, percentages or customer names in the output that don't appear in the provided knowledge (regex extraction + lookup). This is the hallucination guard.
  - JSON validity for structured calls.
- **Model-graded checks** (optional, run manually): a stronger judge model scores brand voice, clarity and CTA on a 1–5 rubric. The judge can be local or cloud. If cloud, it only sees non-sensitive cases (§6).
- **Human blind A/B:** an admin screen showing two outputs for the same brief, anonymized. The media team picks the better one. Results are stored per `ModelVersion`.
- Command: `pnpm --filter @mh/core eval --provider local --model <tag>` → writes `eval/results/<date>-<model>.json` and prints a summary table.

**Acceptance:**
- [ ] The eval runs against `mock` in CI and against `local` on demand.
- [ ] A results file exists for the base local model (baseline).

---

### Phase 4 — Fine-tuning pipeline (`ml/`, Python)

**Goal:** Train a LoRA adapter that writes in Carnegie Robotics' voice and formats, from approved data.

**Prerequisite:** roughly **300–500 approved generations** with `finalText` (from Phase 1). Before that, Phases 0–3 are where the gains are.

**Layout** (outside the pnpm workspace; add `ml/.venv/`, `ml/data/`, `ml/out/` to `.gitignore`):
```
ml/
  README.md
  pyproject.toml          # unsloth (or axolotl), transformers, peft, trl, datasets
  export_dataset.py       # or a TS job — see below
  train_lora.py
  merge_and_export.py     # → GGUF + Ollama Modelfile
  configs/
    base.yaml             # base model, LoRA r/alpha, lr, epochs, max_seq_len
```

**Dataset export** (new worker job `export-training-data`, written in TS so it can reuse Prisma):
- Take `Generation`s whose latest feedback is `APPROVED` or `PUBLISHED`.
- Training example = `{"messages": [{"role":"system","content": <system as logged>}, {"role":"user","content": <prompt as logged>}, {"role":"assistant","content": <finalText>}]}`.
  - The **assistant target is the human-approved final text**, not the raw model output. That's how edits teach the model.
  - The prompt **includes the retrieved facts exactly as they were at generation time**, so the model learns to *use provided context* rather than memorize facts.
- Optional preference pairs for DPO later: `chosen = finalText`, `rejected = output` where `editDistance > 0.3`.
- Exclude: anything with `RETURNED` as the last state, near-duplicates (embedding cosine > 0.95), and anything linked to a sensitive source unless training stays fully on-prem (it does by default).
- Split 90/10 train/validation, grouped by campaign so similar posts don't leak across the split.
- Output `ml/data/<date>/train.jsonl`, `val.jsonl` and a `manifest.json` with counts and the source Generation IDs.

**Training (`train_lora.py`):**
- QLoRA (4-bit base) on the NVIDIA GPU. Unsloth is the fastest option and runs best under **WSL2 on Windows**.
- Starting hyperparameters: LoRA r=16, alpha=32, dropout 0.05, lr 2e-4, 2–3 epochs, max_seq_len 4096, train on assistant tokens only.
- Log train and validation loss. Stop early if validation loss rises.
- Typical runtime: under 1–2 hours for a few thousand examples on a 24 GB card.

**Export (`merge_and_export.py`):**
- Merge the adapter → quantize to GGUF (Q4_K_M or Q5_K_M) → generate an Ollama `Modelfile` → `ollama create mh-writer:<version>`.
- With vLLM, keep the adapter separate and register it as a LoRA module instead.

**Acceptance:**
- [ ] One command runs export → train → export, producing `mh-writer:<version>` in Ollama.
- [ ] The Phase 3 eval runs against it, and the results file is stored.

---

### Phase 5 — Model registry and promotion

**Schema:**
```prisma
model ModelVersion {
  id            String   @id @default(cuid())
  tag           String   @unique   // e.g. mh-writer:2026-11-15
  baseModel     String
  adapterPath   String?
  datasetManifest Json
  evalResults   Json?
  status        String   // CANDIDATE | ACTIVE | RETIRED
  createdAt     DateTime @default(now())
  promotedAt    DateTime?
  promotedById  String?
}
```
- The active local model is read from `ModelVersion(status=ACTIVE)` (cached ~60 s), falling back to `LOCAL_TEXT_MODEL`.
- **Promotion rule** (enforced in the admin UI; managers only): a candidate can become ACTIVE only if
  - its automatic checks pass rate is ≥ the current ACTIVE model's, and
  - it wins or ties the blind A/B on ≥ 20 comparisons.
- One-click **rollback** to the previous ACTIVE version.
- Optional: **shadow mode**, where a candidate generates in the background for real briefs and the outputs are only shown in the A/B screen.
- **Cadence:** retrain monthly, or when ≥150 new approved examples exist. A repeating job notifies managers when the threshold is reached. Training stays a manual, human-started step.

---

### Phase 6 — Engagement metrics

- New `PostMetric { variantId, fetchedAt, impressions, likes, comments, shares, clicks, saves, raw Json }`.
- Repeating job `fetch-post-metrics` pulls from each platform API using `PostVariant.externalId` and existing `SocialAccount` tokens, at 24 h, 7 d and 30 d after `postedAt`.
- Compute a normalized engagement score per platform (z-score vs. trailing 90 days).
- Use it in two places:
  - Weighting style examples (Phase 2).
  - Weighting or filtering training examples (Phase 4): over-sample top performers, drop the bottom decile.

---

### Phase 7 (optional) — Local image generation

- Add an `AI_IMAGE_PROVIDER=local` path in `generateImage()` that calls a local ComfyUI (or similar) HTTP API on the same GPU box.
- Brand look comes from a **style LoRA** trained on approved Carnegie Robotics photography: 30–100 curated images, captioned. Product shots stay real photos. AI images are for backgrounds and scenes only, matching the existing `role: 'generated'` layer.
- **License check required:** some popular image models (e.g. FLUX.1 [dev]) ship under non-commercial licenses, while others (e.g. FLUX.1 [schnell], SDXL) have permissive ones. Get sign-off before use.
- GPU contention: text and image models on one card must take turns. Add a simple GPU lock in the worker, or run image jobs on a separate queue with concurrency 1.

---

## 5. "Continual learning" loop (summary)

```
 brief ──▶ generate (RAG + style examples + active model) ──▶ Generation row
                                                              │
     human edits / returns / approves / publishes ◀───────────┘
                     │
                     ▼
            GenerationFeedback (+ PostMetric later)
                     │
   immediate ────────┼──────── batched (monthly / threshold)
   (Phase 2)         │         (Phases 4–5)
   approved posts    │         export dataset → QLoRA train → eval → A/B → promote/rollback
   become style      │
   examples + RAG ◀──┘
```

What updates **immediately:** knowledge base, style examples, prompt templates.
What updates **in batches with human sign-off:** model weights (adapters).

---

## 6. Data sensitivity and routing

Carnegie Robotics has defense-adjacent work, so some technical material may be export-controlled or otherwise restricted. **Get the classification rules from whoever owns export compliance before loading technical documents.**

- Add `sensitivity String @default("PUBLIC")` (`PUBLIC | INTERNAL | RESTRICTED`) to `Source`, `Product`, `Accomplishment` and `BrandFile`, and copy it onto `KnowledgeChunk`.
- `RESTRICTED` content is **never ingested** into the hub. `INTERNAL` content may be used with local providers only.
- **Router rule** in `generateTextDetailed()`: if the selected provider is cloud (`openai` / `anthropic`) and any retrieved chunk is `INTERNAL`, either (a) route the request to `local`, or (b) drop those chunks. Make this a config choice, default (a). Log which happened in `Generation`.
- Fine-tuning data and adapters stay on company hardware. Never upload them to third-party fine-tuning services without approval.
- The inference server binds to the LAN only and has no internet egress requirement once models are downloaded.

---

## Knowledge system

Knowledge is four different things, and generation treats them differently.

- **Brand rules** live on `BrandProfile` (one row per organization). Voice, audience, tagline, visual direction, and the always/never lists go in every prompt. They are not retrieved by search.
- **Playbooks** are `PromptTemplate` rows. `selectPlaybook` picks the most specific active row for the platform, content type, and pillar, then falls back to a seeded generic template. Pillars and content types are data, not enums.
- **Facts** are products, approved claims, accomplishments, crawled pages, and documents. `retrieve` searches that org's chunks. Claims also appear in an "Approved claims" block. The draft is told to use numbers only from that block or from company knowledge.
- **Style examples** are `Source` rows with `kind = SAMPLE_POST`. They are tone only. Their text is kept out of the fact list.

`validateOutput` checks a draft for a confidential name, a number that is not in the facts or claims, a hashtag count outside the playbook, a length over the limit, and a phrase from the brand "never" list. Warnings are stored on `Post.aiWarnings` and `PostVariant.aiWarnings` and shown in the editor. They do not block the draft.

Sensitivity: `RESTRICTED` is never embedded. When the text provider is `openai` or `anthropic`, `INTERNAL` chunks are left out of the prompt and the draft gets an `INTERNAL_OMITTED` warning. The `local` and `mock` providers may use internal chunks. This is option (b) in §6. There is no `Generation` table, so the warning is stored on the post.

A knowledge pack (`knowledge-pack.example/`) is the portable copy of one company's knowledge. It has no organization id. `pnpm kb:import` and Knowledge → Import / Export load it into the company this server is running for. Product connectors (Shopify, and CSV as the second implementation) sync through `ProductSourceConnector`. A shared SKU keeps connector-owned name, price, URL, and description, and pack-owned features, positioning, and links. Usage, part numbers, uploaded documents, and competitor or partner links are kept when a connector refreshes. Competitor and partner passages are labeled as market context so they are not written as our claims.

### Tenancy readiness

There is one organization, slug `default`. Code passes that id around. There is no org switcher, signup, or billing. A second organization exists only inside tests.

These `// TENANCY:` comments are the tables still shared by the whole database:

- `User`, `Invite`, `QuickLink`, `AppSetting`, `Library`, `LibraryImport`, `ScanLease`, `Asset`, `AssetProduct`, `Board`, `Stage`, `TaskCategory`, `Task`, `ActivityEvent`, `Notification`, `ScheduleEvent`, `BrandFile`, `ContentDoc`, `Design`, `Campaign`, `Post`, `PostVariant`, `SocialAccount`, `OAuthState` (schema header).
- `BrandFile` is not org-scoped. New knowledge files use `orgs/<orgId>/` storage keys.
- `Campaign`, `Post`, and `PostVariant` are not org-scoped. They do carry `pillar` and `aiWarnings`.

## 7. Non-goals

- Pretraining a model from scratch.
- Fully automatic retraining or promotion with no human in the loop.
- Running the LLM inside the Electron process.
- Auto-publishing without the existing manager approval workflow. The AI drafts; humans approve.

---

## 8. Open decisions

| # | Decision | Owner | Default if undecided |
|---|---|---|---|
| 1 | Base model family/size (license + eval) | Tyler | Best Apache-2.0 7–14B instruct model on Phase 3 eval |
| 2 | GPU box specs / where inference runs | Tyler + IT | Existing NVIDIA workstation, Ollama as a Windows service |
| 3 | Ollama vs vLLM | Tyler | Ollama until concurrency hurts |
| 4 | Sensitivity classification rules | Export compliance | Treat all technical docs as INTERNAL |
| 5 | Cloud fallback allowed for PUBLIC content? | Marketing lead | Yes, behind `AI_TEXT_PROVIDER` switch |
| 6 | Image model + license | Tyler + legal | Defer Phase 7 |
