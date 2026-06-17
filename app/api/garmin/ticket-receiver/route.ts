import { NextRequest, NextResponse } from "next/server";

// Returns an HTML page that postMessages the service ticket back to the parent Settings page.
// Intended target of Garmin's /sso/embed redirect after login, but currently unreachable:
// Garmin's service-URL whitelist rejects our domain, so it never redirects here in practice
// (see docs/planning/GARMIN_AUTH_REWORK_PLAN.md). Kept in case that changes; the live flow
// in garmin-connect.tsx has the user paste the ticket manually instead.
export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get("ticket");
  const error  = req.nextUrl.searchParams.get("error");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
try {
  var msg = ${ticket ? `{garminTicket:${JSON.stringify(ticket)}}` : `{garminError:${JSON.stringify(error ?? "no_ticket")}}`};
  // Works both when opened as a popup (opener) and embedded as iframe (parent)
  var target = window.opener || window.parent;
  target.postMessage(msg, "*");
  if (window.opener) window.close();
} catch(e) {}
</script></body></html>`;

  // No X-Frame-Options/CSP override needed: this page is always framed by our own
  // /settings page (same origin), already permitted by the global SAMEORIGIN policy.
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
