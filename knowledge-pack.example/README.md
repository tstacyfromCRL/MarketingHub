# Knowledge pack

A knowledge pack is one company's knowledge, with no organization id inside it. Importing it fills the company this Mantis server is running for.

```
knowledge-pack/
  manifest.json          schemaVersion 1, name, updatedAt
  brand.json             voice, audience, tagline, always/never rules
  playbooks/*.json       writing instructions for a platform, content type, or pillar
  products.json          products the company talks about
  claims.json            approved numbers and statements
  accomplishments.json   dated milestones
  sources.json           pages to crawl
  confidential.json      names the model must never write
  examples/*.md          approved past posts (tone only)
  documents/*            reference files (.md, .txt, .pdf, .docx)
```

This folder is **Acme Field Robotics**, a fictional company used by the tests. Do not put a real company's material here.

## Files

`manifest.json` must be schema version 1.

`brand.json` uses the same color objects as the brand kit: `name`, `hex`, `tier`, `format`, `value`.

A playbook has `key`, `name`, and `body`. `platform`, `contentType`, `pillar`, `hashtagMin`, `hashtagMax`, and `maxChars` are optional. The most specific active playbook is the one generation uses.

Products, claims, accomplishments, and sources use `key`. On import that becomes `pack:<key>`, so a later import updates the same row. `sensitivity` is `PUBLIC`, `INTERNAL`, or `RESTRICTED`. Restricted text is stored and never embedded.

Claims may set `asOf`, `expiresAt`, and `productKeys` (keys from `products.json`).

Examples are Markdown with frontmatter:

```
---
key: fair-post
platform: linkedin
pillar: field-notes
contentType: SOCIAL_POST
---

Post text.
```

Documents are `.md`, `.txt`, `.pdf`, or `.docx`. A Markdown file can carry `key` and `sensitivity` in frontmatter. Any document can use a sidecar named `<file>.meta.json` with `{ "key", "sensitivity", "title" }`.

## Commands

```
pnpm kb:import knowledge-pack.example --dry-run
pnpm kb:import knowledge-pack.example --prune
pnpm kb:export ./out-pack
```

`--prune` removes pack-owned rows that are no longer in the folder. Manual rows, uploads, and connector products stay.

Managers can also upload a zip on Knowledge → Import / Export. The first upload is a dry run. Confirm applies it.
