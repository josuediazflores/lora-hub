import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  DB: D1Database;
  ADAPTERS: R2Bucket;
};

type BaseRow = {
  base_id: string;
  name: string;
  family: string;
  parameters: string;
  quant: string;
  base_sha: string;
  hf_repo: string;
  size_bytes: number;
  license: string;
  description: string;
  created_at: number;
};

type AdapterRow = {
  slug: string;
  name: string;
  author: string;
  base_id: string;
  base_sha: string;
  description: string;
  readme_md: string | null;
  license: string;
  tags: string;
  demo_prompt: string | null;
  created_at: number;
  published_at: number | null;
  downloads: number;
  rating_avg: number | null;
  rating_count: number;
};

type VersionRow = {
  slug: string;
  version: string;
  weights_key: string;
  weights_sha256: string;
  weights_size: number;
  config_key: string;
  config_sha256: string | null;
  eval_scores: string | null;
  notes: string | null;
  created_at: number;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type"] }));

app.get("/", (c) =>
  c.json({ name: "lora-hub-storefront", version: "0.1.0" }),
);

app.get("/bases", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM bases ORDER BY name",
  ).all<BaseRow>();
  return c.json({ bases: results.map(serializeBase) });
});

app.get("/adapters", async (c) => {
  const url = new URL(c.req.url);
  const basesParam = url.searchParams.get("bases");
  const tagsParam = url.searchParams.get("tags");
  const q = url.searchParams.get("q");
  const sort = url.searchParams.get("sort") ?? "downloads";
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const where: string[] = [];
  const binds: (string | number)[] = [];

  if (basesParam) {
    const shas = basesParam.split(",").filter(Boolean);
    if (shas.length > 0) {
      where.push(`base_sha IN (${shas.map(() => "?").join(",")})`);
      binds.push(...shas);
    }
  }

  if (tagsParam) {
    const tags = tagsParam.split(",").filter(Boolean);
    for (const t of tags) {
      where.push("(',' || tags || ',') LIKE ?");
      binds.push(`%,${t},%`);
    }
  }

  if (q) {
    where.push("(name LIKE ? OR description LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }

  const orderBy =
    sort === "recent"
      ? "published_at DESC"
      : sort === "rating"
      ? "rating_avg DESC NULLS LAST"
      : "downloads DESC";

  const sql = `
    SELECT * FROM adapters
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  binds.push(limit, offset);

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<AdapterRow>();
  return c.json({ adapters: results.map(serializeAdapter) });
});

app.get("/adapters/:slug", async (c) => {
  const slug = c.req.param("slug");
  const adapter = await c.env.DB.prepare(
    "SELECT * FROM adapters WHERE slug = ?",
  )
    .bind(slug)
    .first<AdapterRow>();
  if (!adapter) return c.json({ error: "not_found" }, 404);

  const { results: versions } = await c.env.DB.prepare(
    "SELECT * FROM adapter_versions WHERE slug = ? ORDER BY created_at DESC",
  )
    .bind(slug)
    .all<VersionRow>();

  return c.json({
    adapter: serializeAdapter(adapter),
    versions: versions.map(serializeVersion),
  });
});

// Streams a single artifact file (adapters.safetensors or adapter_config.json).
app.get("/r2/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const object = await c.env.ADAPTERS.get(key);
  if (!object) return c.json({ error: "object_missing", key }, 404);
  return new Response(object.body, {
    headers: {
      "content-type":
        key.endsWith(".json") ? "application/json" : "application/octet-stream",
      "content-length": String(object.size),
    },
  });
});

// Bumps the download counter; client calls this after a successful install.
app.post("/adapters/:slug/installed", async (c) => {
  const slug = c.req.param("slug");
  await c.env.DB.prepare(
    "UPDATE adapters SET downloads = downloads + 1 WHERE slug = ?",
  )
    .bind(slug)
    .run();
  return c.json({ ok: true });
});

function serializeBase(b: BaseRow) {
  return {
    base_id: b.base_id,
    name: b.name,
    family: b.family,
    parameters: b.parameters,
    quant: b.quant,
    base_sha: b.base_sha,
    hf_repo: b.hf_repo,
    size_bytes: b.size_bytes,
    license: b.license,
    description: b.description,
  };
}

function serializeAdapter(a: AdapterRow) {
  return {
    slug: a.slug,
    name: a.name,
    author: a.author,
    base_id: a.base_id,
    base_sha: a.base_sha,
    description: a.description,
    license: a.license,
    tags: a.tags ? a.tags.split(",").filter(Boolean) : [],
    demo_prompt: a.demo_prompt,
    downloads: a.downloads,
    rating_avg: a.rating_avg,
    rating_count: a.rating_count,
    published_at: a.published_at,
  };
}

function serializeVersion(v: VersionRow) {
  let evalScores: unknown = null;
  if (v.eval_scores) {
    try {
      evalScores = JSON.parse(v.eval_scores);
    } catch {
      evalScores = null;
    }
  }
  return {
    version: v.version,
    weights_size: v.weights_size,
    weights_sha256: v.weights_sha256,
    files: [
      {
        name: "adapters.safetensors",
        path: `/r2/${v.weights_key}`,
        size: v.weights_size,
        sha256: v.weights_sha256 || null,
      },
      {
        name: "adapter_config.json",
        path: `/r2/${v.config_key}`,
        size: null,
        sha256: v.config_sha256 || null,
      },
    ],
    eval_scores: evalScores,
    notes: v.notes,
  };
}

export default app;
