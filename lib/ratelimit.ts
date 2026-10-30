// Per-IP token bucket. ponytail: per-instance memory; move to a shared store if abuse spans instances.
const buckets = new Map<string, { tokens: number; at: number }>();

export function allow(key: string, capacity: number, refillPerMin: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * refillPerMin);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value!);
  return ok;
}

export function ipOf(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function tooMany() {
  return Response.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
}
