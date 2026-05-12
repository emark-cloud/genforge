import { runLLM } from "@/lib/run-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom for LLM (6–20s) + post-LLM lint (~2s) + possible single retry.
// 60s is the Vercel Hobby ceiling.
export const maxDuration = 60;

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
  const result = await runLLM({ flow: "generate", raw, headers: req.headers });
  return Response.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
