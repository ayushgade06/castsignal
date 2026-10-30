// Thin typed client for the Qloo hackathon API. Server-only: reads the key from env.
import { z } from "zod";

export type CallMeta = {
  endpoint: string;
  params: Record<string, string>;
  status: number;
  ms: number;
  count: number;
  cached: boolean;
};
export type QlooResult<T> = { data: T; meta: CallMeta };

export class QlooError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 12_000;
const TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
// ponytail: per-instance cache; use Vercel Runtime Cache/KV if quota bites.
const cache = new Map<string, { at: number; body: unknown; status: number }>();

export function clearQlooCache() {
  cache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function describeStatus(status: number): string {
  if (status === 401) return "Qloo rejected the request (401): wrong host or key";
  if (status === 403) return "Qloo refused this entity type (403)";
  if (status === 400) return "Qloo rejected the parameters (400)";
  if (status === 429) return "Qloo rate limit hit (429); try again in a minute";
  if (status === 0) return "Qloo timed out or was unreachable";
  return `Qloo server error (${status})`;
}

/** GET a Qloo endpoint with timeout, one retry on 429/5xx/timeout, and an LRU+TTL cache. 404 = empty result. */
export async function qlooGet(
  path: string,
  params: Record<string, string | number | undefined>,
  opts: { retryDelayMs?: number } = {},
): Promise<{ body: unknown; meta: Omit<CallMeta, "count"> }> {
  const base = process.env.QLOO_API_BASE || "https://hackathon.api.qloo.com";
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new QlooError(401, path, "QLOO_API_KEY is not configured on the server");

  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") clean[k] = String(v);
  const url = `${base}${path}?${new URLSearchParams(clean)}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) {
    cache.delete(url); // refresh LRU position
    cache.set(url, hit);
    return { body: hit.body, meta: { endpoint: path, params: clean, status: hit.status, ms: 0, cached: true } };
  }

  const started = Date.now();
  let status = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: ctrl.signal });
      status = res.status;
      if (res.ok || status === 404) {
        const body = status === 404 ? {} : await res.json();
        const ms = Date.now() - started;
        console.log(`[qloo] ${path} ${status} ${ms}ms`);
        cache.set(url, { at: Date.now(), body, status });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return { body, meta: { endpoint: path, params: clean, status, ms, cached: false } };
      }
      if (status !== 429 && status < 500) break; // 4xx other than 429: don't retry
    } catch {
      status = 0; // timeout / network
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await sleep((opts.retryDelayMs ?? 800) * (status === 429 ? 2 : 1));
  }
  console.log(`[qloo] ${path} failed status=${status}`);
  throw new QlooError(status, path, describeStatus(status));
}

// ---- Schemas: only the fields we use ----
const Tag = z.object({ name: z.string().nullish(), id: z.string().nullish() }).passthrough();
const Props = z
  .object({
    image: z.object({ url: z.string() }).partial().nullish(),
    release_year: z.number().nullish(),
  })
  .passthrough()
  .nullish();

export const SearchSchema = z.object({
  results: z
    .array(
      z.object({
        entity_id: z.string(),
        name: z.string(),
        popularity: z.number().nullish(),
        disambiguation: z.string().nullish(),
        types: z.array(z.string()).nullish(),
        tags: z.array(Tag).nullish(),
        properties: Props,
      }),
    )
    .default([]),
});

const ExplRow = z.object({ entity_id: z.string(), score: z.number() });
export const InsightEntitiesSchema = z.object({
  results: z
    .object({
      entities: z
        .array(
          z.object({
            entity_id: z.string(),
            name: z.string(),
            popularity: z.number().nullish(),
            subtype: z.string().nullish(),
            tags: z.array(Tag).nullish(),
            properties: Props,
            query: z
              .object({
                affinity: z.number().nullish(),
                explainability: z.record(z.string(), z.array(ExplRow)).nullish(),
              })
              .passthrough()
              .nullish(),
          }),
        )
        .default([]),
    })
    .default({ entities: [] }),
});

const AGE_KEYS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;
export const DemographicsSchema = z.object({
  results: z
    .object({
      demographics: z
        .array(
          z.object({
            entity_id: z.string(),
            query: z.object({
              age: z.object(Object.fromEntries(AGE_KEYS.map((k) => [k, z.number()])) as Record<(typeof AGE_KEYS)[number], z.ZodNumber>),
              gender: z.object({ male: z.number(), female: z.number() }),
            }),
          }),
        )
        .default([]),
    })
    .default({ demographics: [] }),
});

const CompareTag = z.object({
  tag_id: z.string(),
  name: z.string(),
  subtype: z.string().nullish(),
  query: z.object({ count: z.union([z.string(), z.number()]).nullish() }).passthrough().nullish(),
});
export const CompareSchema = z.object({
  results: z
    .object({
      a: z.array(CompareTag).default([]),
      b: z.array(CompareTag).default([]),
      tags: z.array(CompareTag).default([]),
    })
    .default({ a: [], b: [], tags: [] }),
});

// ---- Typed calls ----
export type Entity = {
  id: string;
  name: string;
  popularity: number | null;
  disambiguation: string | null;
  image: string | null;
  tags: string[];
};

function toEntity(e: z.infer<typeof SearchSchema>["results"][number]): Entity {
  return {
    id: e.entity_id,
    name: e.name,
    popularity: e.popularity ?? null,
    disambiguation: e.disambiguation || (e.properties?.release_year ? String(e.properties.release_year) : null),
    image: e.properties?.image?.url ?? null,
    tags: (e.tags ?? []).map((t) => t.name).filter((n): n is string => !!n),
  };
}

export async function search(query: string, type: string, take = 3): Promise<QlooResult<Entity[]>> {
  const { body, meta } = await qlooGet("/search", { query, types: type, take });
  const data = SearchSchema.parse(body).results.map(toEntity);
  return { data, meta: { ...meta, count: data.length } };
}

export type Scored = Entity & { affinity: number | null; drivers: { id: string; score: number }[] };

export async function insightsEntities(params: Record<string, string | number | undefined>): Promise<QlooResult<Scored[]>> {
  const { body, meta } = await qlooGet("/v2/insights", params);
  const data = InsightEntitiesSchema.parse(body).results.entities.map((e) => ({
    id: e.entity_id,
    name: e.name,
    popularity: e.popularity ?? null,
    disambiguation: null,
    image: e.properties?.image?.url ?? null,
    tags: (e.tags ?? []).map((t) => t.name).filter((n): n is string => !!n),
    affinity: e.query?.affinity ?? null,
    drivers: (e.query?.explainability?.["signal.interests.entities"] ?? []).map((r) => ({ id: r.entity_id, score: r.score })),
  }));
  return { data, meta: { ...meta, count: data.length } };
}

export type Demo = { age: Record<(typeof AGE_KEYS)[number], number>; gender: { male: number; female: number } };

export async function demographics(ids: string[]): Promise<QlooResult<Record<string, Demo>>> {
  const { body, meta } = await qlooGet("/v2/insights", {
    "filter.type": "urn:demographics",
    "signal.interests.entities": ids.join(","),
  });
  const rows = DemographicsSchema.parse(body).results.demographics;
  const data = Object.fromEntries(rows.map((r) => [r.entity_id, r.query]));
  return { data, meta: { ...meta, count: rows.length } };
}

export type CompareTagOut = { name: string; subtype: string; count: number };

export async function compare(aIds: string[], bIds: string[], take = 25) {
  const { body, meta } = await qlooGet("/v2/analysis/compare", {
    "a.signal.interests.entities": aIds.join(","),
    "b.signal.interests.entities": bIds.join(","),
    take,
  });
  const r = CompareSchema.parse(body).results;
  const map = (t: z.infer<typeof CompareTag>): CompareTagOut => ({
    name: t.name,
    subtype: (t.subtype ?? "").replace("urn:tag:", ""),
    count: Number(t.query?.count ?? 0),
  });
  const data = { a: r.a.map(map), b: r.b.map(map), shared: r.tags.map(map) };
  return { data, meta: { ...meta, count: data.a.length + data.b.length + data.shared.length } };
}
