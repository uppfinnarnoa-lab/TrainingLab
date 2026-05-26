# Security Audit — TrainingLab

**Datum:** 2026-05-26  
**Scope:** Hela applikationen — auth, API-rutter, kryptering, klientsida, infrastruktur  
**Metod:** 3 oberoende pass (auth/OAuth/AI, API-rutter/databas, infrastruktur/klientsida)  
**Deployment-kontext:** Self-hosted Ubuntu/Apache, publikt internet, enskild användare

---

## Sammanfattning

| Severity | Antal | Status |
|---|---|---|
| HIGH | 6 | Att åtgärda innan deploy |
| MEDIUM | 9 | Åtgärda inom kort |
| LOW | 7 | Bör åtgärdas |
| INFO | 1 | Informationell |

Inga kritiska brister hittades. Autentisering finns på alla API-rutter. `userId` hämtas alltid från sessionen, aldrig från request-data. Inga SQL-injektioner eller `eval()`. AES-256-GCM används korrekt (slumpmässig IV per kryptering). Ingen `dangerouslySetInnerHTML`.

---

## HIGH — Åtgärda innan deploy

---

### H1 — Ingen rate limiting på inloggning

**Fil:** `auth.ts:31–44`, `middleware.ts:4`

Inloggningsendpointen `/api/auth/callback/credentials` är undantagen från middleware-matcharen och har ingen rate limiting. Obegränsat antal inloggningsförsök möjligt.

**Attack:** Brute-force mot lösenordet utan lockout. Med bcrypt-cost 12 (~250 ms/försök) kan tusentals lösenord testas per timme utan begränsning.

**Fix:** Lägg till rate limiting (IP-baserad) i `authorize()`-callbacken i `auth.ts`, eller intercepta POST i `app/api/auth/[...nextauth]/route.ts` innan delegation till handlers. Använd PostgreSQL-backed räknare (inte in-memory Map) för att överleva omstarter.

---

### H2 — OAuth tokens sparas i klartext i databasen

**Fil:** `app/api/strava/callback/route.ts:27–34`, `app/api/garmin/callback/route.ts:22–28`, `prisma/schema.prisma:64–77`

`StravaAccount.accessToken/refreshToken` och `GarminAccount.accessToken/refreshToken` skrivs direkt till PostgreSQL utan kryptering. Encrypt-funktionerna används för API-nycklar men inte för OAuth-tokens.

**Attack:** Vid databasläckage (backup-exponering, SQL-injection på annan plats, lateral movement) är Strava- och Garmin-tokens direkt användbara för att läsa all aktivitetsdata och hälsodata.

**Fix:** Wrappa token-skrivningar med `encryptIfNeeded()` och läsningar med `safeDecrypt()` — båda funktionerna finns redan i `lib/encrypt.ts`. Migrera befintliga rader med ett engångsskript.

---

### H3 — Krypteringsnyckel härleds via SHA-256 direkt från AUTH_SECRET (ingen KDF)

**Fil:** `lib/encrypt.ts:7–11`

AES-256-GCM-nyckeln deriveras som `sha256(AUTH_SECRET)`. SHA-256 är inte en key derivation function — ingen kostnadsfaktor, inget salt. `AUTH_SECRET` används också som JWT-signeringsnyckel av NextAuth. Om `AUTH_SECRET` är svagt (passphrase i stället för `openssl rand -base64 32`) är alla krypterade hemligheter offline-dekrypterbara.

**Attack:** Databasexfiltration + svag `AUTH_SECRET` → alla lagrade Strava/Garmin/AI-API-nycklar dekrypteras med ordboksattack.

**Fix:** Använd HKDF eller en separat `ENCRYPTION_KEY`-miljövariabel. Återanvänd inte JWT-signeringsnyckeln som krypteringshuvudnyckel.
```ts
import { hkdfSync } from "crypto";
const key = hkdfSync("sha256",
  Buffer.from(process.env.ENCRYPTION_KEY!),
  Buffer.alloc(0),
  "traininglab-secrets-v1",
  32
);
```

---

### H4 — Inga security headers

**Fil:** `next.config.ts:1–7`

Inga HTTP-säkerhetsheaders är konfigurerade. Apache-lagret lägger till `X-Frame-Options` och `X-Content-Type-Options`, men ingen CSP eller HSTS finns någonstans.

**Attack:**
- Utan CSP: all XSS (t.ex. från AI-genererat innehåll) kan exfiltrera sessionscookies
- Utan HSTS: första anslutning via HTTP är sårbar för SSL-strip
- `X-Powered-By: Next.js` exponerar ramverk för rekognosering

**Fix:** Lägg till i `next.config.ts`:
```ts
export default {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "X-Content-Type-Options",    value: "nosniff" },
        { key: "X-Frame-Options",           value: "SAMEORIGIN" },
        { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",   // Next.js kräver unsafe-inline
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: *.strava.com *.basemaps.cartocdn.com",
            "connect-src 'self'",
            "font-src 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      ],
    }];
  },
} satisfies NextConfig;
```

---

### H5 — OAuth redirect_uri härleds från Host-headern

**Fil:** `app/api/strava/callback/route.ts:17`, `app/api/garmin/callback/route.ts:13`

```ts
const redirectUri = `${req.nextUrl.origin}/api/strava/callback`;
```

`req.nextUrl.origin` reflekterar `Host`-headern, som är attackerkontrollerbar vid felkonfigurerad Apache/ProxyPreserveHost.

**Attack:** Om Host-headern kan manipuleras kan `redirect_uri` peka på attackerens server → Strava skickar access_token till fel server.

**Fix:** Hårdkoda från miljövariabeln:
```ts
const redirectUri = `${process.env.NEXTAUTH_URL}/api/strava/callback`;
```
`NEXTAUTH_URL` finns redan i `.env.example`.

---

### H6 — OAuth-flöden saknar state-parameter (CSRF-skydd)

**Fil:** `app/api/strava/callback/route.ts:7–44`, `app/api/garmin/callback/route.ts:6–38`

Varken Strava- eller Garmin-callback validerar en `state`-parameter. OAuth 2.0 kräver detta för CSRF-skydd på OAuth-flödet.

**Attack:** Angriparen genererar en authorization code för sitt eget Strava-konto, lurar den inloggade användaren att besöka `https://app.example.com/api/strava/callback?code=ATTACKER_CODE`. Appen byter ut koden och ersätter användarens Strava-koppling med angriparens tokens.

**Fix:** Generera ett slumpmässigt `state`-värde före OAuth-redirect, lagra det i en signed cookie, verifiera att det matchar vid callback innan code exchange.

---

## MEDIUM — Åtgärda inom kort

---

### M1 — AI-felmeddelanden läcks till klienten

**Fil:** `app/api/coach/chat/route.ts:268–270`

`err.message` från Anthropic/Google SDK skickas verbatim via SSE-strömmen. SDK-felmeddelanden kan innehålla partiella API-nycklar, endpoint-URLs eller kvotinformation.

**Fix:** Logga fullständigt server-side, skicka generiskt till klienten:
```ts
console.error("[coach/chat]", err);
controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI service error" })}\n\n`));
```

---

### M2 — Cross-user foreign key injection på WorkoutType

**Fil:** `app/api/sports/route.ts:53–59`

`sportId` från request-body valideras som CUID men inte att det tillhör session-användaren. En autentiserad användare kan länka en ny `WorkoutType` till en annan användares `SportCategory`.

**Fix:**
```ts
const sport = await prisma.sportCategory.findUnique({ where: { id: parsed.data.sportId } });
if (!sport || sport.userId !== session.user.id)
  return NextResponse.json({ error: "invalid_sport" }, { status: 400 });
```

---

### M3 — Cross-user foreign key injection på WorkoutTemplate

**Fil:** `app/api/planner/templates/route.ts:50–76`, `app/api/planner/templates/[id]/route.ts:37–68`

`sportId` och `typeId` i templates valideras inte som tillhörande session-användaren. `include: { sport: true, type: true }` i query-svaret returnerar då data från en annan användares sport-konfiguration.

**Fix:** Samma ägarskapscheck som M2, för både `sportId` och `typeId`.

---

### M4 — `encryptIfNeeded` colon-oracle — plaintext kan lagras utan kryptering

**Fil:** `lib/encrypt.ts:40–44`

"Redan krypterat"-checken är `value.split(":").length === 3`. Alla plaintext-värden med exakt två kolon (URLs, IPv6, etc.) hoppar över kryptering och lagras i klartext.

**Fix:** Lägg till ett fast prefix `enc:` på alla krypterade värden:
```ts
export function encrypt(text: string): string {
  // ... existing AES-GCM ...
  return `enc:${iv}:${authTag}:${ciphertext}`;
}
export function encryptIfNeeded(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("enc:")) return value;
  return encrypt(value);
}
```
Kräver engångsmigration av befintliga krypterade värden i DB (lägg till prefix).

---

### M5 — Leaflet CSS/bilder laddas från cdnjs utan Subresource Integrity

**Fil:** `app/(dashboard)/activities/[id]/activity-map.tsx:37–39, 66`

Leaflet-CSS och markerbilder hämtas från `cdnjs.cloudflare.com` utan `integrity`-attribut.

**Attack:** CDN-kompromiss → skadlig CSS laddas på kartsidan (CSS-injection kan exfiltrera DOM-data).

**Fix:** Kopiera Leaflet-filer från det installerade npm-paketet till `/public/leaflet/` och använd lokala sökvägar. Leaflet är redan i `dependencies`.

---

### M6 — seed-user.ts loggar lösenord i klartext + svagt default

**Fil:** `scripts/seed-user.ts:13, 44`

Fallback-lösenord `changeme123` + lösenordet loggas till stdout (hamnar i PM2-loggar).

**Fix:**
```ts
const password = process.env.SEED_PASSWORD;
if (!password) { console.error("Set SEED_PASSWORD env var"); process.exit(1); }
// ...
console.log(`✓ Created user: ${email}`); // Ta bort lösenordet
```

---

### M7 — `Cache-Control: public` på privata aktivitetsströmmar

**Fil:** `app/api/activities/[id]/streams/route.ts:38–40`

`Cache-Control: public, max-age=604800` på endpoint som returnerar privat GPS/HR-data. Om ett caching-lager (Apache mod_cache, CDN) aktiveras kan data cachas och serveras till andra.

**Fix:** Ändra till `Cache-Control: private, max-age=604800`.

---

### M8 — approvedAction skickas direkt till verktygsexekutorn utan AI-validering

**Fil:** `app/api/coach/chat/route.ts:114–116`

En klient kan POST:a `approvedAction: { toolName: "delete_workout", toolInput: {...} }` direkt, utan att gå via AI-flödet. Godkännandeflödets intent kringgås helt.

**Begränsad påverkan:** `userId` hämtas alltid från sessionen — ingen cross-user-attack möjlig. Skadan begränsas till den autentiserade användarens egna data.

**Fix:** Validera `toolName` mot `WRITE_TOOLS`-listan. Validera `toolInput`-shape per verktyg mot samma schema som AI-toolsen definierar.

---

### M9 — sameSite: "lax" i stället för "strict" på sessionscookien

**Fil:** `auth.ts:21–27`

Med `sameSite: "lax"` skickas cookien vid top-level GET-navigeringar från cross-origin. Strikta `"strict"` passar bättre för en personlig app utan delningsbehov.

**Fix:** Ändra till `sameSite: "strict"` i `auth.ts`.

---

## LOW — Bör åtgärdas

---

### L1 — In-memory rate limiter nollställs vid procesomstart

**Fil:** `lib/rate-limit.ts:4`

`const attempts = new Map()` i module-scope. PM2 `reload` eller `max_memory_restart` nollställer alla räknare.

**Fix:** Persist räknare i PostgreSQL för login-pathen specifikt, eller ta bort `max_memory_restart: "512M"` som kan triggas under normal last.

---

### L2 — Deployment-guide saknar brandvägg, fail2ban, process-isolation

**Fil:** `docs/guides/deployment.md`

Port 3000 (Next.js direkt) är exponerad mot internet om ingen brandvägg blockerar. Inga instruktioner för `ufw`, `fail2ban`, dedikerat servicekonto, eller `.env.local`-rättigheter.

**Fix:** Lägg till sektion "Security Hardening":
```bash
# Blockera direkt access till Next.js-porten
sudo ufw allow OpenSSH
sudo ufw allow 'Apache Full'
sudo ufw enable

# Env-fil-rättigheter
chmod 600 /var/www/traininglab/.env.local

# Kör som dedikerat konto (ingen shell, ingen sudo)
sudo useradd --system --no-create-home traininglab
```
Lägg också till fail2ban med `apache-auth`-jail mot login-endpoint.

---

### L3 — next-auth pinnat till beta-release

**Fil:** `package.json:31`

```json
"next-auth": "^5.0.0-beta.28"
```

NextAuth v5 stable är släppt. Beta.28 kan sakna säkerhetsfixar från stable.

**Fix:** `pnpm update next-auth` → bör ge `^5.x.x` stable.

---

### L4 — Ovaliderade datumsträngar i planner workouts

**Fil:** `app/api/planner/workouts/route.ts:28–29`

`from` och `to` query-params passas direkt till `new Date()` utan formatvalidering → ogiltiga värden ger Prisma-fel och 500-svar.

**Fix:**
```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (from && !DATE_RE.test(from)) return NextResponse.json({ error: "invalid_from" }, { status: 400 });
if (to   && !DATE_RE.test(to))   return NextResponse.json({ error: "invalid_to" },   { status: 400 });
```

---

### L5 — Middleware returnerar redirect i stället för 401 för API-anrop

**Fil:** `middleware.ts:3–5`

Oautentiserade `fetch()`-anrop till `/api/**` får en 302-redirect till `/login` i stället för 401. Alla routes har egna `auth()`-checks (korrekt), men om en framtida route missar sin check faller man tillbaka på redirect-beteendet.

**Fix:** Lägg till i auth-middleware-callback: returnera `NextResponse.json({ error: "unauthorized" }, { status: 401 })` för paths matchande `/api/**` (exkl. `/api/auth/**`).

---

### L6 — bcrypt cost factor-paritet vid kontoskapande

**Fil:** `app/api/settings/password/route.ts:41`

Lösenordsbyte använder cost 12 (korrekt). Om det ursprungliga kontot skapades med lägre kostnadsfaktor kvarstår det tills lösenordet byts.

**Fix:** Vid lyckad inloggning, kontrollera om hashen använder lägre cost än aktuell target — re-hasha i bakgrunden om det stämmer.

---

### L7 — PostCSS CVE som transitiv dependency

**Fil:** `package.json` (transitiv via `next`)

PostCSS `<8.5.10` har en XSS-risk i build-miljön (GHSA-qx2v-qp2m-jg93, CVSS moderate). Påverkar inte runtime.

**Fix:**
```json
// package.json (pnpm overrides-sektion i pnpm.overrides eller packageManager)
"pnpm": {
  "overrides": { "postcss": ">=8.5.10" }
}
```

---

## INFORMATIONAL

---

### I1 — .env.local på disk i appmappen

**Fil:** `.env.local` (i projektroten)

`.gitignore` täcker det med `.env*`-glob. Risk om Apache-konfiguration råkar serva statiska filer från projektroten.

**Rekommendation:** Flytta `.env.local` utanför webroten vid deploy (t.ex. `/etc/traininglab/env`), läs in via systemd `EnvironmentFile=` eller PM2 `env_file`.

---

## Prioriterad åtgärdsordning

| # | Finding | Jobb | Påverkan |
|---|---|---|---|
| 1 | **H1** — Login rate limiting | Lägg till IP-räknare i `authorize()` | Stoppar brute force |
| 2 | **H4** — Security headers | 15 rader i `next.config.ts` | Eliminerar XSS-klass |
| 3 | **H5 + H6** — OAuth redirect + state | Hardkoda redirectUri, lägg till state-cookie | Stoppar OAuth CSRF |
| 4 | **M7** — Public cache | Ändra ett ord | Skyddar hälsodata |
| 5 | **H2** — OAuth tokens klartext | Wrap med encrypt/decrypt | DB-exponering |
| 6 | **M2 + M3** — FK ownership | 2 ownership-checks per route | Cross-user data |
| 7 | **H3 + M4** — KDF + krypteringsorakel | Ny ENCRYPTION_KEY + enc:-prefix | Stärker krypteringen |
| 8 | **L2** — Deployment hardening | ufw + fail2ban + filrättigheter | Nätverksnivå |
| 9 | **M6** — Seed-script lösenord | Ta bort default + log | Credential exposure |

---

_Audit genomförd med 3 pass: autentisering/OAuth/AI, API-rutter/databas, infrastruktur/klientsida._
