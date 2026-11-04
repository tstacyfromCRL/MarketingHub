# Mantis

Mantis is the desktop app Carnegie Robotics marketing uses to keep brand, assets, and publishing in one place. It learns the company's voice from a brand profile and knowledge base, drafts social posts and campaigns, and routes them through creator and manager approval before anything is published. Files in the asset library stay on the shared Marketing & Media drive. Mantis indexes them. It does not move the library onto a cloud drive.

The window title and installer name are **Mantis**. Sign-in, company setup, and Settings → About show the Mantis wordmark. The top bar, window icon, and desktop notifications use the mantis icon. Some internal package names still say `marketing-hub` or `@mh`. Those are code names, not the product name.

## How it fits together

```
Desktop app (Electron)
    talks to the API at http://localhost:4000
        Fastify server  →  Postgres + pgvector
                        →  file storage (local folder or MinIO)
                        →  background jobs (inside the server, or Redis + worker)
                        →  optional local AI (Ollama) or a cloud model
```

| Piece | Where | What it does |
|---|---|---|
| Desktop app | `apps/desktop` | The only interface. Electron, React, port 5173 while developing. |
| API | `apps/server` | Fastify on port 4000. Auth, library, posts, knowledge, settings. |
| Worker | `apps/worker` | Runs background jobs when `REDIS_URL` is set. Unused in the simple local setup. |
| Database | `packages/db` | Postgres with pgvector. In day-to-day development this is PGlite on `127.0.0.1:5432`. |
| Shared logic | `packages/core`, `packages/shared`, `packages/render` | AI providers, post workflow, knowledge retrieval, image rendering. |

One company lives on one server. The first account is an admin created from **Create New Company**. Later people join with a one-time invite code.

## What you need

Required for the way this repo is run today:

- **Windows** (the asset library talks to a Windows network drive)
- **Node.js 20 or newer** (this machine uses 24)
- **pnpm 9.15.9** (`packageManager` in the root `package.json`)
- **Git**
- **Cursor** or VS Code, to start the app from the launch configuration

Not required for a normal local run:

- Docker. Use it only if you want real Postgres, Redis, and MinIO instead of PGlite.
- An OpenAI or Anthropic key. With no key, AI calls use the built-in `mock` provider.
- Ollama. Only needed when `AI_TEXT_PROVIDER` or `AI_EMBED_PROVIDER` is `local`.
- Social app credentials. Publishing stays off until those are filled in.

## First-time setup

From the repo root:

```powershell
pnpm install
copy .env.example .env
```

Edit `.env` before the first launch.

For the local PGlite database (no Docker), set:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1&sslmode=disable&pgbouncer=true
REDIS_URL=
STORAGE_DRIVER=local
```

`connection_limit=1`, `sslmode=disable`, and `pgbouncer=true` are required. PGlite is one Postgres session, and Prisma's prepared statements collide without `pgbouncer=true`.

Leave `REDIS_URL` empty. Jobs then run inside the API process. If that line points at Redis and Redis is not running, background work fails.

Set `JWT_SECRET` to a long random string. Generate an `ENCRYPTION_KEY` when you connect social accounts:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Apply migrations after the database is listening (start **Dev database (PGlite)** or **Mantis (all)** first, once):

```powershell
pnpm db:deploy
```

PGlite has no shadow database, so new migrations are applied with `pnpm db:deploy`, not `pnpm db:migrate`.

## Starting the app

In Cursor, open **Run and Debug** and start **Mantis (all)**. That starts four things together:

1. **Dev database (PGlite)** on `127.0.0.1:5432`. Data is in `packages/db/.pglite`.
2. **API server** on port 4000.
3. **Desktop: main process** (Electron).
4. **Desktop: UI**, attached to the Electron debugger on port 9222.

The API process in that launch configuration does not watch for file changes. After you change server code, stop and start **Mantis (all)** again. The desktop window reloads on its own, and changes to the desktop main process restart that window.

Only one PGlite process may use `packages/db/.pglite`. Starting a second one aborts both. Stop **Mantis (all)** before starting the database by itself.

Equivalent commands, if you are not using the debugger:

```powershell
pnpm dev:db
pnpm dev:server
pnpm dev:desktop
```

Start the database first and wait until it prints that it is listening.

On the sign-in screen, **Connection settings** must be `http://localhost:4000`. Port 5173 is the dev UI, not the API. If the address is wrong, Login and Create Account stay disabled.

## Using Mantis

### Signing in

When the database has no users, the screen offers **Create company**. That creates the admin, then opens company setup.

When a company already exists, the screen is email, password, **Login**, and **Create Account**. Create Account needs an invite code from an admin (Settings, the gear icon, then Team). Codes look like `MH-XXXX-XXXX` and work once.

If the server is unreachable, those buttons stay disabled. Open Connection settings and set the address to `http://localhost:4000`. Do not reset the database to get Create company back unless you mean to erase the company.

### Roles

- **Creator** drafts content and sends it for approval.
- **Manager** reviews, edits, and approves or returns work. Managers can do everything a creator can.
- **Admin** does everything a manager can, plus team invites, the library location, and system settings.

### Screens

After sign-in, the mantis icon sits at the left of the top bar. The top row is Home, Calendar, Tasks, Studio, and Knowledge. Settings is the gear icon. The icon links back to Home. The question mark at the right of that row explains the screen you are on: what it is for, how to use it, and why it matters. The same control is on the sign-in screen and on company setup. On Knowledge and Settings it follows the tab you have open. A text box at the bottom of signed-in screens can start a post draft or a task from a plain sentence, such as a LinkedIn post for next week or a task for a teammate tomorrow. It asks when a name or network is unclear. It does not publish, approve, or delete. Those stay on their buttons. Set `AI_TEXT_PROVIDER=openai` and `OPENAI_API_KEY` when you want wording beyond those examples. With `mock`, the two example shapes still work.

- **Home** is the view after sign-in.
- **Calendar** holds scheduled posts and team events.
- **Tasks** is a kanban board (Backlog, To Do, In Progress, Review, Done). Each card can move to the next stage, be edited, be archived, or be deleted. Archive keeps the task and takes it off the board; Archived in the filter brings it back. Delete asks first.
- **Studio** is where content is made. Its row is Content, Campaigns, Approvals, Library, and Brand.
  - **Content** drafts a single post, email, blog, or documentation page from a brief. AI uses the brand profile and retrieved knowledge. On **Social post**, the flow is: describe the idea → Write with AI (editable tagline, sub-tagline, and post copy) → pick a library photo and a Canva brand template → Create draft & edit in Canva. Mantis fills the photo into the image data field, the tagline into the first text data field, and the sub-tagline into the second, then opens Canva. When Canva sends the person back, Mantis saves a PNG on the post graphic and the open post updates to that finished design. Approve the draft; a manager sets the time and schedules it. The Graphics tab lists saved graphics. Select several to delete them, move them into a folder, or tag them with products. Deleting a folder leaves the graphics under Unfiled. A graphic on a scheduled or posted item is left in place. **New from Canva** creates a standalone design the same way (tagline, sub-tagline, photo, template, or a blank design). **Edit in Canva** opens an existing Canva graphic again. A manager connects the Canva account under Settings → Social accounts. `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` go in `.env`. In the Canva developer portal, the redirect URL is `{PUBLIC_API_URL}/canva/callback` and the return URL is `{PUBLIC_API_URL}/canva/return`. Brand templates and autofill need a Canva plan that includes them. Templates need two text data fields and an image data field for the full social-post fill.
  - **Campaigns** plans a set of posts across a date range and builds the graphics.
  - **Approvals** is the manager queue.
  - **Library** has two tabs. **Shared drive** shows thumbnails of files imported from the Marketing & Media drive. **Canva** browses folders and uploaded images from the connected Canva account (Settings → Social accounts). Open a folder, load more when the list continues, and select an image for its preview, tags, and size. Canva's API does not return videos in folder listings yet. Thumbnails from Canva expire after about 15 minutes; refresh if one goes blank. The Canva app needs the `folder:read` scope. If the account was connected before that scope was added, a manager reconnects Canva after enabling folder read in the Canva developer portal.
  - **Brand** holds the brand kit, products, the knowledge base, and analytics.
    - **Brand kit** is logos, colors, fonts, backgrounds, and patterns or overlays. In the graphics editor, Background, Overlay, Logo, and Image place the ones you choose. The visual identity text still leads a generated image. When it names a 60-30-10 theme, an AI layout uses the 60% color for the type field, the 30% color for the accent, and the 10% color for the type.
    - **Products** are the products AI may mention and match in images. Knowledge → Products is where you set part numbers, price, what the product does, how it is used, documentation files and links, and competitor or partner websites and social pages. Brand → Products edits the same record.
    - **Analytics** summarizes posts and review time.
- **Knowledge** is the brand profile, playbooks, approved claims, confidential names, products, connectors, documents, and crawled pages. On Brand, **How posts should look** is the same visual identity as Brand kit. It leads every generated image, and a 60-30-10 theme written there sets the graphic colors. Example pictures of past posts are sent with the next generated image, and once any are saved the graphic uses their frame: the photo above a banner in the theme's main color, the accent as a chevron and line pattern, and the logo in the banner. The four newest examples are used for the image request. They are style references, not images to copy. On a product you can upload documentation or paste documentation links, record part numbers and a price, and describe what the product does and how it is used. Competitor and partner websites and social pages are read as market context, and the writer is told not to present them as our claims. Import / Export loads a knowledge pack. AI warnings on a post are shown, and they do not block the draft. Brand still links here.
- **Settings** is your account, social connections (managers), the team (admins), the work log, and system status (admins). The work log is every significant action across the team.

### Publishing a post

A post moves in one direction unless a manager sends it back:

Draft → Creator approved → In manager review → Scheduled → Posted

A manager can return a post to the creator with a note. A failed publish can be retried. Nothing posts by itself without a manager approval.

### Asset library

**Shared drive.** An admin sets the library location once: the top-level folder of the Marketing & Media network drive. Other PCs resolve that same share. If the drive is not mapped, Mantis says the drive was not found and to contact an admin.

Anyone signed in can **Import folders** or **Import files**. Mantis indexes only those paths. The rest of the drive stays out of the library. A scan can take a while when it builds thumbnails; files show up in the grid as each batch finishes, not only when the scan ends. The bar under the Studio menu shows how many files were found and how many are indexed. Pause holds the scan. Cancel stops it. Files already indexed stay, and files the scan has not reached are left as they were.

Search, filters, import, and the selection toolbar sit directly under the Studio menu and stay there while the thumbnails scroll. Select thumbnails to add tags, assign a product, or move files into a folder. Moving creates the folder on the shared drive and moves the real files. **Remove** drops a file from the Mantis index and leaves it on the drive. The same remove action is on the file details panel.

An orange product name under a thumbnail is a match the AI is not sure about. The check confirms it and the X rejects it. Those buttons leave once you decide. Open the file to change that decision or add a product yourself.

**Not for public use** grays a file or an imported folder. The files stay in the library. AI does not tag them, match them to products, or place them in a generated graphic. Flag a folder from the folder row or from the file details. **Use in New Design** opens the studio editor with that image on a new graphic. The image is read from the shared drive on this PC.

**Canva.** Library → Canva lists folders and uploaded images from the connected Canva account. It does not copy those files onto the shared drive. Canva Connect does not return videos in folder listings. Full-resolution download is not available through Connect; the panel shows Canva's preview thumbnail, tags, and size.

### Company setup

Create New Company walks through the company name, a short description, a summary to approve, logos, colors, and voice. Sample posts teach the writing style. You can leave and come back; a banner on the home screen links to the unfinished steps.

### AI

`AI_TEXT_PROVIDER`, `AI_EMBED_PROVIDER`, `AI_IMAGE_PROVIDER`, and `AI_VISION_PROVIDER` in `.env` choose the model. `mock` needs no key and is what local development uses. `openai` and `anthropic` need their API keys. `local` calls an OpenAI-compatible server, usually Ollama:

```
AI_TEXT_PROVIDER=local
AI_EMBED_PROVIDER=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_TEXT_MODEL=qwen2.5:7b
LOCAL_EMBED_MODEL=nomic-embed-text
LOCAL_EMBED_DIMS=768
```

Qwen2.5 7B Instruct is Apache-2.0 and fits in about 8 GB of video memory at 4-bit. Use `qwen2.5:14b` if the GPU has about 12 GB. After changing the embedding model, open Settings → System and run **Re-index knowledge base**. Until that finishes, search ignores chunks stored at the old size. Settings also shows whether the local model server is reachable.

A knowledge pack is a folder (or a zip of that folder) described in `knowledge-pack.example/README.md`. `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_TOKEN` are optional and apply only when Shopify has not been saved in Knowledge → Integrations. `KNOWLEDGE_WATCH_DIR` is an optional folder of documents to index every 10 minutes. Leave it empty to disable that.

## Where data lives

| Data | Location |
|---|---|
| Database files (PGlite) | `packages/db/.pglite` |
| Uploaded files, when `STORAGE_DRIVER=local` | `.data/storage` |
| Desktop sign-in and server address | `%APPDATA%\Mantis\settings.json` |

Do not commit `.env`, `packages/db/.pglite`, or `.data`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev:db` | PGlite on port 5432 |
| `pnpm dev:server` | API with reload |
| `pnpm dev:desktop` | Electron app |
| `pnpm db:deploy` | Apply migrations |
| `pnpm db:generate` | Regenerate the Prisma client after a schema change |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Unit tests |
| `pnpm kb:import <dir>` | Import a knowledge pack (`--dry-run`, `--prune`) |
| `pnpm kb:export <dir>` | Write the current knowledge back out as a pack |
| `pnpm dist:desktop` | Windows installer |

## Docker, when you want it

`docker compose up` starts Postgres 16 (pgvector), Redis, and MinIO. Point `.env` at the values in `.env.example` (`postgresql://mh:mh@localhost:5432/marketinghub`, Redis, and `STORAGE_DRIVER=s3`). Do not run that Postgres and PGlite on port 5432 at the same time.

## When something looks stuck

**Can't reach the database at 127.0.0.1:5432.** The PGlite process is not running, or a second copy was started against the same data folder. Stop **Mantis (all)** and start it once. If the database log says it cannot find a valid checkpoint, the data directory was shut down uncleanly and needs a recovery before it will listen again.

**Every welcome button is gray.** The desktop cannot reach the API. Connection settings must be `http://localhost:4000`, and the API terminal must show that it is listening. Port 5173 will not work.

**Create New Company is gray, Login is not.** A company already exists. Sign in with the admin account.

**Knowledge search misses obvious facts after an AI change.** Re-index the knowledge base from Settings → System.
