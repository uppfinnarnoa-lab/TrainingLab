import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req as NextRequest & { auth: typeof req.auth };

  const isLoggedIn = !!session?.user;
  // @ts-expect-error custom field
  const status: string | undefined = session?.user?.status;

  const isAuthPage = nextUrl.pathname.startsWith("/login") ||
                     nextUrl.pathname.startsWith("/register") ||
                     nextUrl.pathname.startsWith("/pending");

  // Not logged in → send to login (except auth pages themselves)
  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Logged in but pending/rejected → send to /pending (except the pending page itself)
  if (isLoggedIn && status !== "active" && !isAuthPage) {
    return NextResponse.redirect(new URL("/pending", req.url));
  }

  // Logged in and active → redirect away from login/register to dashboard
  if (isLoggedIn && status === "active" && (nextUrl.pathname === "/login" || nextUrl.pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|api/admin|api/strava/webhook|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
