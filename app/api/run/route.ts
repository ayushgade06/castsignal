import { runAgent } from "@/lib/agent";
import { RunRequestSchema } from "@/lib/brief";
import { allow, ipOf, tooMany } from "@/lib/ratelimit";
import type { RunEvent } from "@/lib/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!allow(`run:${ipOf(req)}`, 8, 1)) return tooMany();
  const text = await req.text();
  if (text.length > 20_000) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RunRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid brief", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (e: RunEvent) => {
        if (open) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      try {
        await runAgent(parsed.data, emit);
      } catch (e) {
        console.log(`[run] fatal: ${(e as Error).message}`);
        emit({ type: "error", text: "The run failed unexpectedly. Please retry.", retryable: true });
        emit({ type: "done" });
      } finally {
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
