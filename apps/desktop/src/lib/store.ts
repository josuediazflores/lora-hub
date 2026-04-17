const STOREFRONT_URL =
  (import.meta.env.VITE_STOREFRONT_URL as string | undefined) ??
  "http://localhost:8787";

export type StoreBase = {
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
};

export type StoreAdapter = {
  slug: string;
  name: string;
  author: string;
  base_id: string;
  base_sha: string;
  description: string;
  license: string;
  tags: string[];
  demo_prompt: string | null;
  downloads: number;
  rating_avg: number | null;
  rating_count: number;
  published_at: number | null;
};

export type StoreFile = {
  name: string;
  path: string; // path relative to STOREFRONT_URL, e.g. "/r2/<key>"
  size: number | null;
  sha256: string | null;
};

export type StoreVersion = {
  version: string;
  weights_size: number;
  weights_sha256: string | null;
  files: StoreFile[];
  eval_scores: Record<string, number> | null;
  notes: string | null;
};

export type AdapterDetail = {
  adapter: StoreAdapter & { readme_md?: string | null };
  versions: StoreVersion[];
};

export type ListAdaptersQuery = {
  bases?: string[];
  tags?: string[];
  q?: string;
  sort?: "downloads" | "rating" | "recent";
  limit?: number;
  offset?: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${STOREFRONT_URL}${path}`);
  if (!res.ok) {
    throw new Error(`storefront ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchBases(): Promise<StoreBase[]> {
  const { bases } = await get<{ bases: StoreBase[] }>("/bases");
  return bases;
}

export async function fetchAdapters(
  query: ListAdaptersQuery = {},
): Promise<StoreAdapter[]> {
  const params = new URLSearchParams();
  if (query.bases?.length) params.set("bases", query.bases.join(","));
  if (query.tags?.length) params.set("tags", query.tags.join(","));
  if (query.q) params.set("q", query.q);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();
  const { adapters } = await get<{ adapters: StoreAdapter[] }>(
    `/adapters${qs ? "?" + qs : ""}`,
  );
  return adapters;
}

export async function fetchAdapter(slug: string): Promise<AdapterDetail> {
  return await get<AdapterDetail>(`/adapters/${slug}`);
}

export function absolutize(path: string): string {
  return `${STOREFRONT_URL}${path}`;
}

export async function markInstalled(slug: string): Promise<void> {
  try {
    await fetch(`${STOREFRONT_URL}/adapters/${slug}/installed`, {
      method: "POST",
    });
  } catch {
    // best-effort; client-side install can succeed even if telemetry fails
  }
}
