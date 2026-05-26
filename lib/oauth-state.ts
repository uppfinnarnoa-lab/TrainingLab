// CSRF protection for OAuth flows.
// State = base64url( userId:timestamp:hmac )
// Verified on callback — must match userId in session and be less than 10 min old.

import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set");
  return s;
}

export function generateOAuthState(userId: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}:${ts}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyOAuthState(state: string | null, userId: string): boolean {
  if (!state) return false;
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const lastColon = decoded.lastIndexOf(":");
    const secondLastColon = decoded.lastIndexOf(":", lastColon - 1);
    if (secondLastColon === -1) return false;
    const uid = decoded.slice(0, secondLastColon);
    const ts  = decoded.slice(secondLastColon + 1, lastColon);
    const sig = decoded.slice(lastColon + 1);
    if (uid !== userId) return false;
    if (Date.now() - parseInt(ts, 10) > 600_000) return false;
    const expected = createHmac("sha256", secret()).update(`${uid}:${ts}`).digest("hex").slice(0, 32);
    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}
