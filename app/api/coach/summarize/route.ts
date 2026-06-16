import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { conversationId } = await req.json();
  if (!conversationId) return new Response("Missing conversationId", { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId, userId: session.user.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
  });
  if (!conv) return new Response("Not found", { status: 404 });

  return Response.json({ messages: conv.messages.length });
}
