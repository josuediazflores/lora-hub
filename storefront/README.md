# LoRA Hub storefront

Cloudflare Worker exposing the adapter catalog.

Stack: Hono + D1 (SQLite) + R2 (object store).

## Local dev

```bash
cd storefront
npm install
npm run db:reset:local   # creates schema + seeds 10 sample adapters
npm run dev              # wrangler dev on http://localhost:8787
```

Once running:

```bash
curl http://localhost:8787/bases
curl 'http://localhost:8787/adapters?limit=5&sort=downloads'
curl 'http://localhost:8787/adapters?bases=PLACEHOLDER_GEMMA_3_4B_SHA&tags=code'
curl http://localhost:8787/adapters/sql-generator
```

## Endpoints

- `GET /bases` — roster of curated base models.
- `GET /adapters?bases=<csv of base_shas>&tags=<csv>&q=<search>&sort=downloads|rating|recent&limit=&offset=`
  — filtered adapter list. `bases` filters to **installed-by-user** bases; the client should always pass it.
- `GET /adapters/:slug` — adapter detail with all versions + download URLs.
- `GET /download/:slug/:version` — streams the adapter artifact from R2 and
  increments the download counter.

## Deploy

```bash
wrangler login
wrangler d1 create lora-hub-storefront   # copy the id into wrangler.toml
wrangler r2 bucket create lora-hub-adapters
npm run db:init
npm run db:seed
npm run deploy
```

## Placeholder SHAs

`seed.sql` uses `PLACEHOLDER_GEMMA_3_4B_SHA` for the base fingerprint. Before
enabling compat filtering in production, replace this with the real SHA emitted
by the sidecar's `base_fingerprint` op against `mlx-community/gemma-3-4b-it-4bit`.
