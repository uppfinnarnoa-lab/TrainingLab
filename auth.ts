import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const isProd = process.env.NODE_ENV === "production";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProd,
      },
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const rl = checkRateLimit(`login:${parsed.data.email}`, 10, 600);
        if (!rl.allowed) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        // Gate: only active accounts may log in
        if (user.status === "pending") throw new Error("pending");
        if (user.status === "rejected") throw new Error("rejected");

        return { id: user.id, email: user.email, name: user.name, status: user.status, isAdmin: user.isAdmin };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // @ts-expect-error custom fields not in default User type
        token.status = user.status;
        // @ts-expect-error custom fields not in default User type
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      // @ts-expect-error custom fields not in default Session type
      session.user.status = token.status;
      // @ts-expect-error custom fields not in default Session type
      session.user.isAdmin = token.isAdmin;
      return session;
    },
  },
});
