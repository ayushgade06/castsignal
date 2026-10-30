import { z } from "zod";
import { search, QlooError } from "@/lib/qloo";
import { allow, ipOf, tooMany } from "@/lib/ratelimit";

const Q = z.object({ q: z.string().trim().min(2).max(80), kind: z.enum(["title", "person"]) });

/** Autocomplete for the brief form: Qloo /search, names/years/images only. */
export async function GET(req: Request) {
  if (!allow(`resolve:${ipOf(req)}`, 40, 40)) return tooMany();
  const url = new URL(req.url);
  const p = Q.safeParse({ q: url.searchParams.get("q"), kind: url.searchParams.get("kind") });
  if (!p.success) return Response.json({ results: [] });
  try {
    const type = p.data.kind === "title" ? "urn:entity:movie,urn:entity:tv_show" : "urn:entity:person";
    const { data } = await search(p.data.q, type, 6);
    return Response.json({
      results: data.map((e) => ({ id: e.id, name: e.name, disambiguation: e.disambiguation, image: e.image })),
    });
  } catch (e) {
    const status = e instanceof QlooError ? e.status : 0;
    return Response.json({ results: [], error: "Qloo search is unavailable", status }, { status: 502 });
  }
}
