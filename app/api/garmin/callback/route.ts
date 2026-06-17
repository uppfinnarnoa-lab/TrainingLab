// Legacy Garmin OAuth callback — no longer used since migrating to email/password auth.
// Kept as a safe redirect so old bookmarks or incomplete OAuth flows land gracefully.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/settings", req.url));
}
