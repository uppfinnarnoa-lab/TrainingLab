import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const rl = checkRateLimit(`summarize:${session.user.id}`, 20, 60);
  if (!rl.allowed) return new Response(JSON.stringify({ error: "rate_limited", retryAfter: rl.resetIn }), { status: 429, headers: { "Content-Type": "application/json" } });

  const { conversationId } = await req.json();
  if (!conversationId) return new Response("Missing conversationId", { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId, userId: session.user.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
  });
  if (!conv) return new Response("Not found", { status: 404 });

  return Response.json({ messages: conv.messages.length });
}
