import { runScan } from "@/lib/run-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lint (~2-8s) + LLM (5-15s). No retry path, so we don't need the full 60s.
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { error: "request body must be valid JSON" },
      { status: 400 },
    );
  }
  const result = await runScan({ raw, headers: req.headers });
  return Response.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
