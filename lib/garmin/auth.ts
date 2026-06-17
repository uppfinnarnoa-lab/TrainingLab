// Garmin Connect unofficial OAuth2 authentication.
// Flow: SSO login (email+password) → service ticket → OAuth1 preauthorized → OAuth2 Bearer tokens.
// Tokens last ~1 hour (access) and ~6 months (refresh), stored encrypted in GarminAccount.
// No email/password is persisted — only the resulting tokens.

import { createHmac, randomBytes } from "crypto";

// Garmin Connect Mobile app consumer credentials (embedded in the Android/iOS app,
// widely known in open-source Garmin tooling; used to authenticate as the mobile client).
const CONSUMER_KEY    = "fc3e99d2-118c-44b8-8ae3-03370dde24c0";
const CONSUMER_SECRET = "E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF";

const SSO_BASE    = "https://sso.garmin.com/sso";
const CONNECT_API = "https://connectapi.garmin.com";

// ── Cookie jar ──────────────────────────────────────────────────────────────

class CookieJar {
  private jar = new Map<string, string>();

  absorb(headers: Headers): void {
    // Node.js 20+ exposes getSetCookie(); fall back to naive comma-split on older runtimes.
    type H = Headers & { getSetCookie?: () => string[] };
    const raw: string[] = typeof (headers as H).getSetCookie === "function"
      ? (headers as H).getSetCookie!()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*[a-zA-Z_-]+=)/);

    for (const cookie of raw) {
      const main = cookie.split(";")[0].trim();
      const eq   = main.indexOf("=");
      if (eq > 0) this.jar.set(main.slice(0, eq).trim(), main.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── OAuth1 signing (RFC 5849) ───────────────────────────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauth1Header(
  method: string,
  url: string,
  extra: Record<string, string> = {},
  token?: string,
  tokenSecret?: string,
): string {
  const ts    = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     CONSUMER_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        ts,
    oauth_version:          "1.0",
    ...extra,
  };
  if (token) oauthParams.oauth_token = token;

  // Build signature base string — must include URL query params
  const urlObj     = new URL(url);
  const allParams  = { ...oauthParams };
  urlObj.searchParams.forEach((v, k) => { allParams[k] = v; });

  const paramStr  = Object.keys(allParams).sort().map(k => `${pct(k)}=${pct(allParams[k])}`).join("&");
  const baseStr   = `${method.toUpperCase()}&${pct(urlObj.origin + urlObj.pathname)}&${pct(paramStr)}`;
  const sigKey    = `${pct(CONSUMER_SECRET)}&${tokenSecret ? pct(tokenSecret) : ""}`;
  const signature = createHmac("sha1", sigKey).update(baseStr).digest("base64");

  const all: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const parts = Object.keys(all)
    .filter(k => k.startsWith("oauth_"))
    .map(k => `${k}="${pct(all[k])}"`)
    .join(", ");

  return `OAuth realm="", ${parts}`;
}

// ── Step 1: SSO page → CSRF token ──────────────────────────────────────────

async function fetchSsoPage(jar: CookieJar): Promise<string> {
  const params = new URLSearchParams({
    service:                         "https://connect.garmin.com/modern/",
    webhost:                         "https://connect.garmin.com/modern/",
    source:                          "https://connect.garmin.com/signin/",
    redirectAfterAccountLoginUrl:    "https://connect.garmin.com/modern/",
    redirectAfterAccountCreationUrl: "https://connect.garmin.com/modern/",
    gauthHost:                       SSO_BASE,
    locale:                          "en_US",
    id:                              "gauth-widget",
    clientId:                        "GarminConnect",
    consumeServiceTicket:            "false",
    initialFocus:                    "true",
    embedWidget:                     "false",
    generateExtraServiceTicket:      "true",
    generateTwoExtraServiceTickets:  "true",
    generateNoServiceTicket:         "false",
    connectLegalTerms:               "true",
    showTermsOfUse:                  "false",
    showPrivacyPolicy:               "false",
    showConnectLegalAge:             "false",
    locationPromptShown:             "true",
    showPassword:                    "true",
    useCustomHeader:                 "false",
    globalOptInShown:                "true",
    globalOptInChecked:              "false",
    mobile:                          "false",
    rememberMeShown:                 "true",
    rememberMeChecked:               "false",
  });

  const res = await fetch(`${SSO_BASE}/signin?${params}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TrainingLab/1.0)",
      Cookie:       jar.header(),
    },
  });
  jar.absorb(res.headers);
  if (!res.ok) throw new Error(`Failed to load Garmin SSO page: ${res.status}`);
  return res.text();
}

// ── Step 2: POST credentials → service ticket ───────────────────────────────

async function submitCredentials(
  email: string,
  password: string,
  csrf: string,
  jar: CookieJar,
): Promise<string> {
  const queryParams = new URLSearchParams({
    service:                         "https://connect.garmin.com/modern/",
    webhost:                         "https://connect.garmin.com/modern/",
    source:                          "https://connect.garmin.com/signin/",
    redirectAfterAccountLoginUrl:    "https://connect.garmin.com/modern/",
    redirectAfterAccountCreationUrl: "https://connect.garmin.com/modern/",
    gauthHost:                       SSO_BASE,
    locale:                          "en_US",
    id:                              "gauth-widget",
    clientId:                        "GarminConnect",
    consumeServiceTicket:            "false",
    generateExtraServiceTicket:      "true",
    generateTwoExtraServiceTickets:  "true",
    generateNoServiceTicket:         "false",
    connectLegalTerms:               "true",
    mobile:                          "false",
  });

  const body = new URLSearchParams({
    username:            email,
    password,
    _csrf:               csrf,
    embed:               "false",
    displayNameRequired: "false",
  });

  const res = await fetch(`${SSO_BASE}/signin?${queryParams}`, {
    method:   "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":   "Mozilla/5.0 (compatible; TrainingLab/1.0)",
      Cookie:         jar.header(),
      Referer:        `${SSO_BASE}/signin`,
    },
    body: body.toString(),
  });
  jar.absorb(res.headers);

  const location = res.headers.get("location") ?? "";

  if (!location) {
    const text = await res.text();
    if (/mfaCode|MFA|verificationCode|two-factor/i.test(text)) {
      throw new Error("GARMIN_MFA_REQUIRED");
    }
    if (res.status === 403 || /InvalidUsernamePassword|badCredentials|username-or-password/i.test(text)) {
      throw new Error("GARMIN_INVALID_CREDENTIALS");
    }
    throw new Error(`Garmin SSO login failed: HTTP ${res.status}`);
  }

  const ticketMatch = location.match(/[?&]ticket=(ST-[^&\s]+)/);
  if (!ticketMatch) throw new Error(`No service ticket in SSO redirect: ${location.slice(0, 100)}`);
  return decodeURIComponent(ticketMatch[1]);
}

// ── Step 3: ticket → OAuth1 token via preauthorized endpoint ────────────────

async function ticketToOAuth1(
  ticket: string,
  jar: CookieJar,
): Promise<{ token: string; secret: string }> {
  const endpoint = `${CONNECT_API}/oauth-service/oauth/preauthorized`;
  const params   = new URLSearchParams({
    ticket,
    "login-url":          `${SSO_BASE}/sso/login`,
    "accepts-mfa-tokens": "true",
  });
  const fullUrl    = `${endpoint}?${params}`;
  const authHeader = oauth1Header("GET", fullUrl);

  const res = await fetch(fullUrl, {
    headers: {
      Authorization: authHeader,
      Cookie:        jar.header(),
    },
  });
  jar.absorb(res.headers);

  if (!res.ok) throw new Error(`Garmin preauthorized endpoint failed: ${res.status}`);
  const text   = await res.text();
  const parsed = new URLSearchParams(text);
  const tok    = parsed.get("oauth_token");
  const sec    = parsed.get("oauth_token_secret");
  if (!tok || !sec) throw new Error("Missing oauth_token in preauthorized response");
  return { token: tok, secret: sec };
}

// ── Step 4: OAuth1 token → OAuth2 Bearer tokens ─────────────────────────────

async function oauth1ToOAuth2(
  token: string,
  secret: string,
  jar: CookieJar,
): Promise<GarminTokens> {
  const url        = `${CONNECT_API}/oauth-service/oauth/exchange/user/2.0`;
  const authHeader = oauth1Header("POST", url, {}, token, secret);

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      Authorization: authHeader,
      Cookie:        jar.header(),
    },
  });
  jar.absorb(res.headers);

  if (!res.ok) throw new Error(`Garmin OAuth2 exchange failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;

  if (!data.access_token) throw new Error("No access_token in Garmin OAuth2 exchange response");
  return {
    accessToken:  data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? "",
    expiresAt:    new Date(Date.now() + ((data.expires_in as number | undefined) ?? 3600) * 1000),
  };
}

// ── Step 5: fetch display name ──────────────────────────────────────────────

export async function fetchDisplayName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${CONNECT_API}/userprofile-service/userprofile/personal-information`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return (data.displayName as string | undefined) ?? (data.userName as string | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface GarminTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    Date;
}

/** Authenticate with Garmin Connect using email/password.
 *  Returns OAuth2 tokens and the Garmin display name.
 *  The email/password are used only for this call — they are NOT returned or stored. */
export async function loginWithGarmin(
  email: string,
  password: string,
): Promise<GarminTokens & { displayName: string | null }> {
  const jar  = new CookieJar();
  const html = await fetchSsoPage(jar);

  const csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/i);
  if (!csrfMatch) throw new Error("CSRF token not found in Garmin SSO page — Garmin may have changed their login flow");
  const csrf = csrfMatch[1];

  const ticket            = await submitCredentials(email, password, csrf, jar);
  const { token, secret } = await ticketToOAuth1(ticket, jar);
  const tokens            = await oauth1ToOAuth2(token, secret, jar);
  const displayName       = await fetchDisplayName(tokens.accessToken);

  return { ...tokens, displayName };
}

/** Refresh an expired OAuth2 access token using the refresh token. */
export async function refreshGarminTokens(refreshToken: string): Promise<GarminTokens> {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");

  const res = await fetch(`${CONNECT_API}/oauth-service/oauth/token`, {
    method:  "POST",
    headers: {
      Authorization:  `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new Error(`Garmin token refresh failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken:  data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
    expiresAt:    new Date(Date.now() + ((data.expires_in as number | undefined) ?? 3600) * 1000),
  };
}
