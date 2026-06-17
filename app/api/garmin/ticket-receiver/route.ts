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
  window.parent.postMessage(msg, "*");
} catch(e) {}
</script></body></html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Allow postMessage back to parent regardless of origin
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    },
  });
}
