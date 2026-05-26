# TrainingLab — Performance Audit
_2026-05-26_

Priority: HIGH = blocks the user / causes visible freeze; MEDIUM = noticeable lag; LOW = nice to fix.

---

## HIGH

### 1. Stats page blocks on full activity fetch (cache miss)

**File**: `app/(dashboard)/stats/page.tsx` (server component)  
**Problem**: On cache miss the page fetches every activity ever (potentially 5+ years) in a single synchronous call before rendering anything. The user sees a blank page for several seconds.  
**Fix**: Wrap the stats computation in a `<Suspense>` boundary with a skeleton, and consider limiting the initial fetch to the last 365 days with a "load more" option. Alternatively, move the heavy computation to a background job that pre-warms the cache on a schedule.

### 2. `lib/fitness/cache.ts` loads full bestEfforts JSON for all activities

**File**: `lib/fitness/cache.ts`  
**Problem**: Every call to build the fitness cache deserializes the `bestEfforts` JSON blob for every activity in the DB, even for queries that only need zone seconds or volume totals. On a large dataset this is hundreds of MB of JSON deserialization.  
**Fix**: Add a `select` projection to the Prisma query so `bestEfforts` is only fetched when the caller actually needs it. Separate `buildZoneCache` and `buildBestEffortsCache` into independent functions.

---

## MEDIUM

### 3. ChatInterface scrolls to bottom on every streaming chunk

**File**: `components/coach/ChatInterface.tsx`  
**Problem**: The scroll-to-bottom effect runs on every state update during streaming. With fast LLM output this fires 10–30 times per second, causing layout thrashing.  
**Fix**: Throttle the scroll call with `requestAnimationFrame` or a `useRef`-based debounce. Only scroll if the user is already near the bottom (within ~100px).

### 4. Recharts components not memoized

**Files**: `app/(dashboard)/stats/`, `components/activity/`  
**Problem**: Chart components re-render whenever any parent state changes, recomputing large dataset transforms on every render.  
**Fix**: Wrap chart components in `React.memo`. Move dataset transforms (zone seconds → percent, pace series computation) to `useMemo` with stable deps.

### 5. Stats page recomputes zone seconds even when cache is fresh

**File**: `app/(dashboard)/stats/page.tsx`  
**Problem**: Zone second totals are recomputed from raw activity data on every page visit, even though `lib/fitness/cache.ts` already stores pre-aggregated values.  
**Fix**: Read zone totals directly from the cache instead of recomputing. The cache is already invalidated on new activity sync.

---

## LOW

### 6. Dashboard makes 9 separate aggregate queries

**File**: `app/(dashboard)/dashboard/page.tsx` (or equivalent)  
**Problem**: The dashboard issues individual `prisma.activity.aggregate` calls for each metric (count, total distance, total time, etc.), resulting in 9 round-trips per page load.  
**Fix**: Consolidate into a single raw SQL query or use `prisma.$queryRaw` with all aggregates in one statement. Alternatively, cache the dashboard summary in a Redis key or a dedicated DB table refreshed on each sync.

---

## Quick wins (< 1 hour each)

| Item | File | Fix |
|---|---|---|
| `next/image` for activity maps | Any `<img>` tag rendering map tiles | Replace with `<Image>` for automatic lazy-loading |
| Add `loading="lazy"` to heavy chart containers | Stats page | Defers off-screen charts |
| Set `staleTime` on any SWR/React Query calls | Hooks | Avoids unnecessary refetches on tab focus |
| Enable `compress: true` in PM2 ecosystem config | `ecosystem.config.js` | Gzip at PM2 layer as fallback if Apache gzip isn't set |
| Add `Cache-Control: no-store` only where needed | API routes | Currently every route has no caching; static data (sports list, HR zones) can use short `s-maxage` |
