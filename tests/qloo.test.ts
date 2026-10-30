import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  qlooGet, clearQlooCache, QlooError, SearchSchema, InsightEntitiesSchema, DemographicsSchema, CompareSchema,
} from "@/lib/qloo";

const fx = (f: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${f}`, "utf8"));

describe("schemas parse real Qloo responses", () => {
  it("search", () => {
    const r = SearchSchema.parse(fx("search-get-out.json")).results;
    expect(r[0].name).toBe("Get Out");
    expect(r[0].disambiguation).toBe("2017");
  });
  it("insights with explainability", () => {
    const e = InsightEntitiesSchema.parse(fx("insights-fit.json")).results.entities;
    expect(e.length).toBe(4); // 5 requested; Daniel Kaluuya absent (coverage gap)
    expect(e[0].query?.affinity).toBeGreaterThan(0);
    expect(e[0].query?.explainability?.["signal.interests.entities"]?.length).toBe(3);
  });
  it("demographics and compare", () => {
    const d = DemographicsSchema.parse(fx("demographics.json")).results.demographics;
    expect(d[0].query.gender.female).toBeCloseTo(0.63);
    const c = CompareSchema.parse(fx("compare.json")).results;
    expect(c.a.length).toBeGreaterThan(0);
    expect(c.b[0].name).toBe("Horror");
  });
});

describe("qlooGet retry/timeout/cache", () => {
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  beforeEach(() => {
    clearQlooCache();
    process.env.QLOO_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retries once on 429 then succeeds, never leaks the key, and caches", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({}, 429)).mockResolvedValueOnce(res({ results: [] }));
    vi.stubGlobal("fetch", f);
    const r = await qlooGet("/search", { query: "x" }, { retryDelayMs: 0 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.meta.status).toBe(200);
    expect(f.mock.calls[0][1].headers["X-Api-Key"]).toBe("test-key");
    expect(JSON.stringify(r.meta)).not.toContain("test-key");
    const again = await qlooGet("/search", { query: "x" }, { retryDelayMs: 0 });
    expect(again.meta.cached).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("gives up after one retry on 5xx with a QlooError", async () => {
    const f = vi.fn().mockResolvedValue(res({}, 503));
    vi.stubGlobal("fetch", f);
    await expect(qlooGet("/search", { query: "y" }, { retryDelayMs: 0 })).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry 403; treats 404 as empty", async () => {
    const f = vi.fn().mockResolvedValueOnce(res({}, 403));
    vi.stubGlobal("fetch", f);
    await expect(qlooGet("/v2/insights", { a: "1" }, { retryDelayMs: 0 })).rejects.toBeInstanceOf(QlooError);
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(res({}, 404)));
    const r = await qlooGet("/v2/insights", { a: "2" }, { retryDelayMs: 0 });
    expect(r.body).toEqual({});
  });
  it("treats aborts/network errors as timeouts (status 0) and retries once", async () => {
    const f = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", f);
    await expect(qlooGet("/search", { query: "z" }, { retryDelayMs: 0 })).rejects.toMatchObject({ status: 0 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
