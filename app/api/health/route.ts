import { qlooGet } from "@/lib/qloo";

export const dynamic = "force-dynamic";

/** Liveness plus a cached Qloo reachability check. Never returns key material. */
export async function GET() {
  const env = { qloo: !!process.env.QLOO_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY };
  let qloo: string;
  try {
    const r = await qlooGet("/search", { query: "Get Out", types: "urn:entity:movie", take: 1 });
    qloo = `ok (${r.meta.status}${r.meta.cached ? ", cached" : ""})`;
  } catch (e) {
    qloo = `error (${(e as { status?: number }).status ?? "?"})`;
  }
  return Response.json({ ok: true, env, qloo, time: new Date().toISOString() });
}
