import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { BriefSchema } from "@/lib/brief";
import { AGENT_MODEL } from "@/lib/agent";
import { SEGMENTS } from "@/lib/scoring";
import { allow, ipOf, tooMany } from "@/lib/ratelimit";

export const maxDuration = 120;

// The same brief answered by the LLM alone, no tools. Used for the "Why Qloo?" comparison.
const BaselineSchema = z.object({
  roles: z.array(z.object({ role: z.string(), ranking: z.array(z.string()), reasoning: z.string() })),
  audience_claims: z.array(z.object({ name: z.string(), adds_segments: z.array(z.enum(SEGMENTS)) })),
  wildcards: z.array(z.object({ name: z.string(), why: z.string() })),
  ensemble: z.array(z.object({ role: z.string(), name: z.string() })),
  summary: z.string(),
});
export type Baseline = z.infer<typeof BaselineSchema>;

export async function POST(req: Request) {
  if (!allow(`baseline:${ipOf(req)}`, 8, 1)) return tooMany();
  const text = await req.text();
  if (text.length > 20_000) return Response.json({ error: "Request too large" }, { status: 413 });
  const parsed = BriefSchema.safeParse((() => { try { return JSON.parse(text).brief; } catch { return null; } })());
  if (!parsed.success) return Response.json({ error: "Invalid brief" }, { status: 400 });
  const b = parsed.data;

  const prompt = [
    `You are a casting consultant. Without any tools or data lookups, answer from your own knowledge.`,
    `Project: ${b.title}. ${b.logline}`,
    `Comparable titles: ${b.comps.join(", ")}.`,
    ...b.roles.map((r) => `Role "${r.role}" shortlist: ${r.candidates.join(", ")}.`),
    `Target audience segments to grow: ${b.targets.length ? b.targets.join(", ") : "whatever the comps' audience under-covers"}.`,
    `For each role, rank the whole shortlist by how well each person's fan base matches the audience of the comparable titles.`,
    `For every shortlisted person, list which audience segments (${SEGMENTS.join(", ")}) their fans over-index on relative to the comps' audience.`,
    `Suggest three to five cross-over wildcards (comedians, musicians or actors not on the shortlist) whose fans already overlap with the comps.`,
    `Recommend one pick per role for the widest combined audience reach.`,
  ].join("\n");

  try {
    const client = new Anthropic();
    const t0 = Date.now();
    const res = await client.messages.parse({
      model: AGENT_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(BaselineSchema), effort: "low" },
    });
    if (!res.parsed_output) return Response.json({ error: "The LLM returned an unreadable answer" }, { status: 502 });
    return Response.json({ baseline: res.parsed_output, model: AGENT_MODEL, ms: Date.now() - t0 });
  } catch (e) {
    console.log(`[baseline] LLM failure: ${e instanceof Anthropic.APIError ? e.status : (e as Error).message}`);
    return Response.json({ error: "The LLM-only baseline is unavailable right now" }, { status: 502 });
  }
}
