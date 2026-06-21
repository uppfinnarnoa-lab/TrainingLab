// Garmin Connect unofficial OAuth2 authentication.
//
// TWO login flows (tried in order):
//   1. Mobile JSON API (new, June 2026): POST /mobile/api/login → JSON with serviceTicketId
//   2. SSO Embed HTML form (old, may still work): POST /sso/embed → 302 redirect with ticket
//
// Both flows end with the same ticket→OAuth1→OAuth2 exchange.
// No email/password is persisted — only the resulting tokens.

import { createHmac, randomBytes } from "crypto";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Garmin Connect Mobile app consumer credentials (embedded in the Android/iOS app,
// widely known in open-source Garmin tooling; used to authenticate as the mobile client).
const CONSUMER_KEY    = "fc3e99d2-118c-44b8-8ae3-03370dde24c0";
const CONSUMER_SECRET = "E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF";

const SSO_BASE    = "https://sso.garmin.com/sso";
const SSO_EMBED   = `${SSO_BASE}/embed`;   // garth uses /embed — different bot-detection rules than /signin
const CONNECT_API = "https://connectapi.garmin.com";

// Mobile app headers — matches garth library (garminconnect 0.2.x) which works from server IPs.
// Desktop browser UA triggers aggressive bot-detection on the credential POST; mobile app UA does not.
const BROWSER_HEADERS = {
  "User-Agent":      "com.garmin.android.apps.connectmobile",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
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

async function fetchSsoPage(jar: CookieJar): Promise<{ html: string; url: string }> {
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
    embedWidget:                     "true",
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

  const url = `${SSO_EMBED}?${params}`;
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Cookie: jar.header() },
  });
  jar.absorb(res.headers);
  if (!res.ok) throw new Error(`Failed to load Garmin SSO page: ${res.status}`);
  return { html: await res.text(), url };
}

// ── Step 2: POST credentials → service ticket ───────────────────────────────

async function submitCredentials(
  email: string,
  password: string,
  csrf: string,
  jar: CookieJar,
  ssoPageUrl: string,
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
    embedWidget:                     "true",
  });

  const body = new URLSearchParams({
    username:            email,
    password,
    _csrf:               csrf,
    embed:               "true",
    displayNameRequired: "false",
  });

  const res = await fetch(`${SSO_EMBED}?${queryParams}`, {
    method:   "POST",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie:          jar.header(),
      Referer:         ssoPageUrl,
      Origin:          "https://sso.garmin.com",
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
): Promise<{ token: string; secret: string; mfaToken?: string }> {
  const endpoint = `${CONNECT_API}/oauth-service/oauth/preauthorized`;
  const params   = new URLSearchParams({
    ticket,
    // Must be the actual SSO embed URL the ticket was issued against, not an
    // arbitrary login page - Garmin's server validates the ticket against this.
    "login-url":          SSO_EMBED,
    "accepts-mfa-tokens": "true",
  });
  const fullUrl    = `${endpoint}?${params}`;
  const authHeader = oauth1Header("GET", fullUrl);

  const res = await fetch(fullUrl, {
    headers: {
      ...BROWSER_HEADERS,
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
  return { token: tok, secret: sec, mfaToken: parsed.get("mfa_token") ?? undefined };
}

// ── Step 4: OAuth1 token → OAuth2 Bearer tokens ─────────────────────────────

async function oauth1ToOAuth2(
  token: string,
  secret: string,
  jar: CookieJar,
  mfaToken?: string,
): Promise<GarminTokens> {
  const url        = `${CONNECT_API}/oauth-service/oauth/exchange/user/2.0`;
  const authHeader = oauth1Header("POST", url, {}, token, secret);
  // Garmin returns 415 Unsupported Media Type without this header, even for an empty body.
  const body       = mfaToken ? new URLSearchParams({ mfa_token: mfaToken }).toString() : "";

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      ...BROWSER_HEADERS,
      Authorization:  authHeader,
      Cookie:         jar.header(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
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
    if (!res.ok) {
      console.error(`[garmin] fetchDisplayName failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json() as Record<string, unknown>;
    const name = (data.displayName as string | undefined) ?? (data.userName as string | undefined) ?? null;
    if (!name) console.error("[garmin] fetchDisplayName: response had no displayName/userName field", JSON.stringify(data).slice(0, 300));
    return name;
  } catch (e) {
    console.error("[garmin] fetchDisplayName threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Mobile JSON API login (new endpoint, June 2026) ─────────────────────────
// Garmin migrated from HTML form SSO to a JSON mobile API endpoint.
// python-garminconnect uses this as its primary strategy.

const MOBILE_SIGN_IN_URL = "https://sso.garmin.com/mobile/sso/en/sign-in";
const MOBILE_LOGIN_URL   = "https://sso.garmin.com/mobile/api/login";
const MOBILE_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/android";
const MOBILE_CLIENT_ID   = "GCM_ANDROID_DARK";

// iPhone Safari UA — garth evolved to this from the Android app UA to reduce Cloudflare detection.
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H123";

async function loginWithMobileApi(email: string, password: string): Promise<string> {
  const jar = new CookieJar();

  // GET sign-in page to establish session cookies (required before POST)
  const initRes = await fetch(MOBILE_SIGN_IN_URL, {
    headers: {
      "User-Agent": MOBILE_UA,
      "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  jar.absorb(initRes.headers);

  // Anti-WAF delay: Cloudflare/Garmin detect instant GET→POST sequences as bots.
  // 2–5 second random delay mimics a human reading the page before typing.
  await sleep(2000 + Math.random() * 3000);

  const params = new URLSearchParams({
    clientId: MOBILE_CLIENT_ID,
    locale:   "en-US",
    service:  MOBILE_SERVICE_URL,
  });

  const loginRes = await fetch(`${MOBILE_LOGIN_URL}?${params}`, {
    method: "POST",
    headers: {
      "User-Agent":   MOBILE_UA,
      "Content-Type": "application/json",
      "Accept":       "application/json",
      "Cookie":       jar.header(),
      "Origin":       "https://sso.garmin.com",
      "Referer":      MOBILE_SIGN_IN_URL,
    },
    body: JSON.stringify({
      username:     email,
      password,
      rememberMe:   false,
      captchaToken: "",
    }),
  });
  jar.absorb(loginRes.headers);

  if (loginRes.status === 403 || loginRes.status === 429) {
    throw new Error("GARMIN_BLOCKED");
  }

  const data = await loginRes.json() as Record<string, unknown>;
  const status = (data.responseStatus as Record<string, string> | undefined)?.type;

  console.log(`[garmin/auth] Mobile API login response: HTTP ${loginRes.status}, type=${status}`);

  if (status === "INVALID_USERNAME_PASSWORD") throw new Error("GARMIN_INVALID_CREDENTIALS");
  if (status === "MFA_REQUIRED")             throw new Error("GARMIN_MFA_REQUIRED");
  if (status !== "SUCCESSFUL")               throw new Error(`GARMIN_MOBILE_LOGIN_FAILED: ${status}`);

  const ticket = data.serviceTicketId as string | undefined;
  if (!ticket || !ticket.startsWith("ST-")) {
    throw new Error(`GARMIN_MOBILE_LOGIN_FAILED: no service ticket in response`);
  }
  return ticket;
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
 *  Tries the new mobile JSON API first (June 2026 flow), falls back to the
 *  older /sso/embed HTML form if the mobile endpoint is unavailable.
 *  Returns OAuth2 tokens and the Garmin display name.
 *  Email/password are used only for this call — never returned or stored. */
export async function loginWithGarmin(
  email: string,
  password: string,
): Promise<GarminTokens & { displayName: string | null }> {
  let ticket: string;

  // Strategy 1: Mobile JSON API (new flow, June 2026)
  try {
    ticket = await loginWithMobileApi(email, password);
    console.log("[garmin/auth] Mobile API login succeeded");
  } catch (mobileErr) {
    const mobileMsg = mobileErr instanceof Error ? mobileErr.message : String(mobileErr);

    // Propagate credential/MFA errors immediately — no point trying fallback
    if (mobileMsg === "GARMIN_INVALID_CREDENTIALS" || mobileMsg === "GARMIN_MFA_REQUIRED") {
      throw mobileErr;
    }

    console.warn(`[garmin/auth] Mobile API failed (${mobileMsg}), falling back to /sso/embed`);

    // Strategy 2: SSO Embed HTML form (older flow — may still work)
    const jar = new CookieJar();
    const { html, url: ssoPageUrl } = await fetchSsoPage(jar);

    const csrfMatch =
      html.match(/name="_csrf"\s+value="([^"]+)"/i) ??
      html.match(/value="([^"]+)"\s+name="_csrf"/i) ??
      html.match(/<input[^>]+name="_csrf"[^>]*value="([^"]+)"/i) ??
      html.match(/<input[^>]+value="([^"]+)"[^>]*name="_csrf"/i);

    if (!csrfMatch) {
      console.error(`[garmin/auth] CSRF not found. Page excerpt: ${html.slice(0, 500).replace(/\s+/g, " ")}`);
      throw new Error("GARMIN_BLOCKED");
    }

    ticket = await submitCredentials(email, password, csrfMatch[1], jar, ssoPageUrl);
  }

  const jar2                         = new CookieJar();
  const { token, secret, mfaToken }  = await ticketToOAuth1(ticket, jar2);
  const tokens                       = await oauth1ToOAuth2(token, secret, jar2, mfaToken);
  const displayName                  = await fetchDisplayName(tokens.accessToken);

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
