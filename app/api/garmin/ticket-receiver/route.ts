import { NextRequest, NextResponse } from "next/server";

// Returns an HTML page that postMessages the service ticket back to the parent Settings page.
// The Garmin /sso/embed iframe redirects here after successful login with ?ticket=ST-...
// This page immediately passes the ticket to the parent and closes itself.
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
