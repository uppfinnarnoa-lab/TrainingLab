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

// Browser-like headers — Garmin's SSO bot-detection rejects minimal UAs.
const BROWSER_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
  "Sec-Fetch-Dest":  "document",
  "Sec-Fetch-Mode":  "navigate",
  "Sec-Fetch-Site":  "same-origin",
};

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
    headers: { ...BROWSER_HEADERS, Cookie: jar.header() },
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
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Sec-Fetch-Site": "same-origin",
      Cookie:           jar.header(),
      Referer:          `${SSO_BASE}/signin`,
      Origin:           "https://sso.garmin.com",
    },
    body: body.toString(),
  });
  jar.absorb(res.headers);

  const location = res.headers.get("location") ?? "";

  // Successful login: HTTP 302 with a Location containing a service ticket
  if (location) {
    const ticketMatch = location.match(/[?&]ticket=(ST-[^&\s]+)/);
    if (ticketMatch) return decodeURIComponent(ticketMatch[1]);
    // Redirect exists but no ticket — follow to see if it arrives on next hop
    throw new Error(`SSO redirect missing service ticket: ${location.slice(0, 120)}`);
  }

  // No redirect — login did not complete. Read body to diagnose why.
  const text = await res.text();

  // Always log status + body excerpt so PM2 logs show what Garmin returned.
  // Run: pm2 logs traininglab | grep garmin/auth
  console.error(`[garmin/auth] SSO login returned no redirect. Status: ${res.status}. Body[0:500]: ${text.slice(0, 500).replace(/\s+/g, " ")}`);

  // 403 = Garmin blocked the server (IP ban, bot detection) — not bad credentials.
  if (res.status === 403) throw new Error("GARMIN_BLOCKED");

  // Specific MFA check: look for an OTP input field, NOT just "MFA" anywhere in the page.
  // Garmin's login page mentions "Two-Factor Authentication" as an account option even when
  // it's disabled — so we need to detect the actual MFA challenge form, not just keywords.
  const hasMfaInput = /<input[^>]+name=["']?(?:mfaCode|otpCode|totpCode|mfa_code)["']?/i.test(text)
    || /<input[^>]+id=["']?(?:mfa-code|otp-code|mfa_code)["']?/i.test(text);
  if (hasMfaInput) throw new Error("GARMIN_MFA_REQUIRED");

  // Bad credentials
  if (/InvalidUsernamePassword|badCredentials|username-or-password|incorrect password|invalid.*credentials/i.test(text)) {
    throw new Error("GARMIN_INVALID_CREDENTIALS");
  }

  throw new Error(`Garmin SSO login failed: HTTP ${res.status}`);
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

export { CookieJar };
export { ticketToOAuth1, oauth1ToOAuth2 };

/** Generate the Garmin SSO URL that redirects the browser to our callback after login. */
export function getGarminAuthUrl(callbackUrl: string): string {
  const params = new URLSearchParams({
    service:                         callbackUrl,
    webhost:                         "https://connect.garmin.com/modern/",
    source:                          "https://connect.garmin.com/signin/",
    redirectAfterAccountLoginUrl:    callbackUrl,
    redirectAfterAccountCreationUrl: callbackUrl,
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
    mobile:                          "false",
    rememberMeShown:                 "true",
    rememberMeChecked:               "false",
    showPassword:                    "true",
    useCustomHeader:                 "false",
    globalOptInShown:                "true",
    globalOptInChecked:              "false",
    showTermsOfUse:                  "false",
    showPrivacyPolicy:               "false",
    showConnectLegalAge:             "false",
    locationPromptShown:             "true",
  });
  return `${SSO_BASE}/signin?${params}`;
}

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

  // Garmin HTML attribute order varies — try all combinations
  const csrfMatch =
    html.match(/name="_csrf"\s+value="([^"]+)"/i) ??
    html.match(/value="([^"]+)"\s+name="_csrf"/i) ??
    html.match(/<input[^>]+name="_csrf"[^>]*value="([^"]+)"/i) ??
    html.match(/<input[^>]+value="([^"]+)"[^>]*name="_csrf"/i);

  if (!csrfMatch) {
    console.error(`[garmin/auth] CSRF not found in SSO page. Page excerpt: ${html.slice(0, 500).replace(/\s+/g, " ")}`);
    throw new Error("CSRF token not found in Garmin SSO page — Garmin may have changed their login flow");
  }
  const csrf = csrfMatch[1];

  const ticket            = await submitCredentials(email, password, csrf, jar);
  const { token, secret } = await ticketToOAuth1(ticket, jar);
  const tokens            = await oauth1ToOAuth2(token, secret, jar);
  const displayName       = await fetchDisplayName(tokens.accessToken);

  return { ...tokens, displayName };
}

/** Fetch the Garmin SSO page and report what we find — used by /api/garmin/diagnose. */
export async function diagnoseSsoPage(): Promise<{
  ssoReachable: boolean;
  ssoStatus:    number;
  csrfFound:    boolean;
  loginFormFound:    boolean;
  mfaChallengeFound: boolean;
  pageTitle:   string;
  bodyExcerpt: string;
}> {
  const jar = new CookieJar();
  let ssoStatus = 0;
  let html = "";
  try {
    const params = new URLSearchParams({
      service:    "https://connect.garmin.com/modern/",
      gauthHost:  SSO_BASE,
      clientId:   "GarminConnect",
      locale:     "en_US",
      id:         "gauth-widget",
      embedWidget: "false",
    });
    const res = await fetch(`${SSO_BASE}/signin?${params}`, {
      headers: { ...BROWSER_HEADERS, Cookie: jar.header() },
    });
    jar.absorb(res.headers);
    ssoStatus = res.status;
    html = await res.text();
  } catch (e) {
    return { ssoReachable: false, ssoStatus: 0, csrfFound: false, loginFormFound: false, mfaChallengeFound: false, pageTitle: "", bodyExcerpt: String(e) };
  }

  const csrfMatch =
    html.match(/name="_csrf"\s+value="([^"]+)"/i) ??
    html.match(/value="([^"]+)"\s+name="_csrf"/i) ??
    html.match(/<input[^>]+name="_csrf"[^>]*value="([^"]+)"/i) ??
    html.match(/<input[^>]+value="([^"]+)"[^>]*name="_csrf"/i);

  return {
    ssoReachable:      ssoStatus >= 200 && ssoStatus < 400,
    ssoStatus,
    csrfFound:         !!csrfMatch,
    loginFormFound:    /<input[^>]+type=["']?password["']?/i.test(html),
    mfaChallengeFound: /<input[^>]+name=["']?(?:mfaCode|otpCode|totpCode|mfa_code)["']?/i.test(html),
    pageTitle:         (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "").trim().slice(0, 120),
    bodyExcerpt:       html.slice(0, 500).replace(/\s+/g, " "),
  };
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
