import { auth } from "@/auth";
import { backfillRunner } from "@/lib/strava/backfill-runner";
import type { BackfillEvent } from "@/lib/strava/backfill";

/** GET — current job status (in-memory, no DB query) */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(backfillRunner.getStatus(session.user.id));
}

/** PATCH — pause | resume | stop */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { action } = await req.json() as { action: "pause" | "resume" | "stop" };
  if      (action === "pause")  backfillRunner.pause(userId);
  else if (action === "resume") backfillRunner.resume(userId);
  else if (action === "stop")   backfillRunner.stop(userId);

  return Response.json(backfillRunner.getStatus(userId));
}

/** POST — start backfill (or connect to running one) via SSE stream */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  let onEvent: ((e: BackfillEvent) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      onEvent = (event: BackfillEvent) => {
        try { controller.enqueue(send(event)); } catch { /* connection closed */ }
        if (event.type === "done" || event.type === "stopped") {
          try { controller.close(); } catch { /* already closed */ }
          if (onEvent) backfillRunner.unsubscribe(userId, onEvent);
          onEvent = null;
        }
      };

      backfillRunner.subscribe(userId, onEvent);

      // Send current state if connecting to an already-active job
      const current = backfillRunner.getStatus(userId);
      if (current.status !== "idle" && current.status !== "done") {
        controller.enqueue(send({ type: "status", ...current }));
      }

      backfillRunner.start(userId); // no-op if already running/paused/waiting
    },
    cancel() {
      if (onEvent) {
        backfillRunner.unsubscribe(userId, onEvent);
        onEvent = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
