import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { fetchAndSaveWeather } from "@/lib/weather/open-meteo";

/** GET — how many activities are missing weather data */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [total, done] = await Promise.all([
    prisma.activity.count({ where: { userId, startLat: { not: null } } }),
    prisma.activity.count({ where: { userId, startLat: { not: null }, weatherTemp: { not: null } } }),
  ]);

  return Response.json({ total, done, remaining: total - done });
}

/** POST — SSE stream: fetch weather for all activities missing it */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const encoder = new TextEncoder();
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pending = await prisma.activity.findMany({
          where: { userId, weatherTemp: null, startLat: { not: null }, startLng: { not: null } },
          orderBy: { startDate: "asc" },
          select: { id: true, startLat: true, startLng: true, startDate: true },
        });

        const total = pending.length;
        controller.enqueue(send({ type: "start", total }));

        let done = 0, errors = 0;

        for (const act of pending) {
          try {
            await fetchAndSaveWeather(act.id, act.startLat!, act.startLng!, act.startDate);
            done++;
            if (done % 20 === 0 || done === total) {
              controller.enqueue(send({ type: "progress", done, total, errors }));
            }
            // Open-Meteo: ~10k req/day free — 200ms between requests is safe
            await new Promise(r => setTimeout(r, 200));
          } catch {
            errors++;
          }
        }

        controller.enqueue(send({ type: "done", done, total, errors }));
        controller.close();
      } catch (e) {
        controller.enqueue(send({ type: "error", message: String(e) }));
        controller.close();
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
