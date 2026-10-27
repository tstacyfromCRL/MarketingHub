# Mantis

Mantis is the desktop app Carnegie Robotics marketing uses to keep brand, assets, and publishing in one place. It learns the company's voice from a brand profile and knowledge base, drafts social posts and campaigns, and routes them through creator and manager approval before anything is published. Files in the asset library stay on the shared Marketing & Media drive. Mantis indexes them. It does not move the library onto a cloud drive.

The window title, header, and installer name are **Mantis**. Some internal package names still say `marketing-hub` or `@mh`. Those are code names, not the product name.

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

The API process in that launch configuration does not watch for file changes. After you change server code, stop and start **Mantis (all)** again. The desktop UI reloads on its own.

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

After sign-in, the top row is Home, Calendar, Tasks, and Studio. Settings is the gear icon.

- **Home** is the view after sign-in.
- **Calendar** holds scheduled posts and team events.
- **Tasks** is a kanban board (Backlog, To Do, In Progress, Review, Done).
- **Studio** is where content is made. Its row is Content, Campaigns, Approvals, Library, and Brand.
  - **Content** drafts a single post, email, blog, or documentation page from a brief. AI uses the brand profile and retrieved knowledge.
  - **Campaigns** plans a set of posts across a date range and builds the graphics.
  - **Approvals** is the manager queue.
  - **Library** shows thumbnails of files imported from the shared drive.
  - **Brand** holds the brand kit, products, knowledge base, and analytics.
    - **Brand kit** is logos, colors, and fonts.
    - **Products** are the products AI may mention and match in images.
    - **Knowledge** is the brand profile, accomplishments, and uploaded or scraped sources that AI is allowed to use.
    - **Analytics** summarizes posts and review time.
- **Settings** is your account, social connections (managers), the team (admins), the work log, and system status (admins). The work log is every significant action across the team.

Search in the top bar covers posts, tasks, products, assets, and knowledge.

### Publishing a post

A post moves in one direction unless a manager sends it back:

Draft → Creator approved → In manager review → Scheduled → Posted

A manager can return a post to the creator with a note. A failed publish can be retried. Nothing posts by itself without a manager approval.

### Asset library

An admin sets the library location once: the top-level folder of the Marketing & Media network drive. Other PCs resolve that same share. If the drive is not mapped, Mantis says the drive was not found and to contact an admin.

Anyone signed in can **Import folders** or **Import files**. Mantis indexes only those paths. The rest of the drive stays out of the library.

Select thumbnails to add tags, assign a product, or move files into a folder. Moving creates the folder on the shared drive and moves the real files. **Remove** drops a file from the Mantis index and leaves it on the drive. The same remove action is on the file details panel.

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
| `pnpm dist:desktop` | Windows installer |

## Docker, when you want it

`docker compose up` starts Postgres 16 (pgvector), Redis, and MinIO. Point `.env` at the values in `.env.example` (`postgresql://mh:mh@localhost:5432/marketinghub`, Redis, and `STORAGE_DRIVER=s3`). Do not run that Postgres and PGlite on port 5432 at the same time.

## When something looks stuck

**Can't reach the database at 127.0.0.1:5432.** The PGlite process is not running, or a second copy was started against the same data folder. Stop **Mantis (all)** and start it once. If the database log says it cannot find a valid checkpoint, the data directory was shut down uncleanly and needs a recovery before it will listen again.

**Every welcome button is gray.** The desktop cannot reach the API. Connection settings must be `http://localhost:4000`, and the API terminal must show that it is listening. Port 5173 will not work.

**Create New Company is gray, Login is not.** A company already exists. Sign in with the admin account.

**Knowledge search misses obvious facts after an AI change.** Re-index the knowledge base from Settings → System.
