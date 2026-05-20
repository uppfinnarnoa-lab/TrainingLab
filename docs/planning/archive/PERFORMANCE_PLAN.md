# TrainingLab — Performance Improvement Plan

> **Status:** 2026-05-20  
> **Problem:** Several pages are slow to load, especially Stats and Dashboard.  
> This document identifies root causes and prioritized fixes.

---

## 1. Current Bottlenecks — Root Cause Analysis

### 1A. Stats page — slowest page (~3–8s)

**Why:** Server component that does ALL of this on EVERY load:
1. Fetches all activities from the last 5 years (potentially 2,800+ rows)
2. Runs VO2max estimation (multi-model weighted average) in JavaScript
3. Computes ATL/CTL/TSB for every day in the last 365 days
4. Classifies every activity into HR zones
5. Aggregates weekly volumes for 12 weeks
6. Computes Riegel predictions, confidence intervals, polarisation %
7. Fetches all race PBs and computes VDOT anchor

**The problem:** All of this runs on every single page load, even if nothing has changed since the last visit.

### 1B. Dashboard page — moderate (~1–3s)

**Why:** Also fetches activities + runs TSS computation, but for fewer data points.

### 1C. Coach page — first load slow (~2–4s)

**Why:** `buildCoachContext()` fetches 5 years of activities AND runs VO2max estimation in full.

---

## 2. Fixes — Prioritized

### Priority 1: Expand FitnessCache (HIGH IMPACT, LOW EFFORT)

**Current state:** `FitnessCache` stores: `vo2max`, `vdot`, `maxHR`, `restHR`, `zones`, `paces`, `computedAt`.

**Missing from cache:**
- Weekly volume aggregation (computed fresh every Stats load)
- HR zone distribution (12 weeks)
- ACWR, ATL/CTL/TSB snapshot
- Race predictions
- Polarisation %

**Fix:** Add these fields to `FitnessCache` and populate them after each Strava sync:

```prisma
model FitnessCache {
  // existing fields...
  atl              Float?   // today's ATL
  ctl              Float?   // today's CTL
  tsb              Float?   // today's TSB
  acwr             Float?   // 7d/28d workload ratio
  weeklyVolumeJson Json?    // last 12 weeks aggregated volume per sport
  zoneSecondsJson  Json?    // { z1, z2, z3, z4, z5 } seconds last 12w
  polarisationJson Json?    // { z1Pct, z2Pct, z3Pct }
  predictionsJson  Json?    // VDOT + Riegel per distance
}
```

**Stats page** reads from cache (fast DB lookup) instead of recomputing. Falls back to live computation if cache is stale (> 2 hours old).

**Cache update:** Called after every Strava sync and after calibration button.

**Expected speedup:** Stats page: 3–8s → 200–400ms.

---

### Priority 2: Stats page — reduce activity fetch size (MEDIUM IMPACT, LOW EFFORT)

**Problem:** `prisma.activity.findMany` fetches `bestEfforts` and `splitsMetric` for ALL 2,800+ activities. These are large JSON fields — `splitsMetric` alone can be 5–10KB per activity.

**Fix:** Only fetch `bestEfforts`/`splitsMetric` for activities where VO2max computation would use them. In practice: the last 90 days of running activities.

```typescript
// Instead of fetching everything for all activities:
const activities = await prisma.activity.findMany({
  where: { userId, startDate: { gte: subDays(new Date(), 5 * 365) } },
  select: {
    // Base fields (always needed)
    id: true, sportType: true, startDate: true, name: true,
    distance: true, movingTime: true, averageHeartrate: true,
    maxHeartrate: true, averageSpeed: true, isRace: true,
    totalElevationGain: true,
    // Heavy JSON only for recent activities
    bestEfforts: false,   // <-- skip these large fields
    splitsMetric: false,  // <-- skip for bulk load
  },
});

// Separately fetch splits/bestEfforts only for recent quality sessions
const recentQuality = await prisma.activity.findMany({
  where: { userId, startDate: { gte: subDays(now, 90) }, sportType: { in: ['Run','TrailRun'] } },
  select: { id: true, bestEfforts: true, splitsMetric: true, startDate: true, distance: true, movingTime: true },
});
```

**Expected speedup:** DB query time 40–60% faster.

---

### Priority 3: Streaming / Suspense for heavy components (MEDIUM IMPACT, MEDIUM EFFORT)

**Problem:** The Stats page blocks the entire render until ALL data is ready (ATL/CTL, VO2max, weekly volumes, etc.). The user sees a blank page for 3–8 seconds.

**Fix:** Split the Stats page into sections using React Suspense + loading skeletons:

```tsx
// stats/page.tsx
import { Suspense } from "react";

export default function StatsPage() {
  return (
    <div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewSection />   {/* fast: week/month totals */}
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <VolumeSection />     {/* medium: weekly aggregation */}
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <FitnessSection />    {/* slow: VO2max + predictions — show last */}
      </Suspense>
    </div>
  );
}
```

Each section is a separate async server component with its own DB query. Fast sections appear immediately; slow ones stream in with skeleton placeholders.

**Expected improvement:** First content visible in ~300ms instead of 3–8s.

---

### Priority 4: `buildCoachContext()` — cache the expensive parts (MEDIUM IMPACT, LOW EFFORT)

**Problem:** Every chat message triggers `buildCoachContext()` which:
1. Fetches all activities (5 years)
2. Runs VO2max estimation
3. Runs TSS/ATL/CTL curve for 365 days

**Fix:** Read VO2max, ATL/CTL/TSB, zones from `FitnessCache` instead of recomputing:

```typescript
export async function buildCoachContext(userId: string): Promise<CoachContext> {
  const [profile, fitnessCache, activities, ...rest] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId } }),
    prisma.fitnessCache.findUnique({ where: { userId } }),
    // Fetch ONLY recent activities for context (last 90 days, not 5 years)
    prisma.activity.findMany({
      where: { userId, startDate: { gte: subDays(new Date(), 90) } },
      ...
    }),
    // ...other fast queries
  ]);

  // Use cached values instead of recomputing
  const vo2max = fitnessCache?.vo2max ?? 45;
  const ctl = fitnessCache?.ctl ?? 0;
  // etc.
}
```

**Expected speedup:** Chat first-message latency 2–4s → 500ms.

---

### Priority 5: Database indexes (LOW EFFORT, MEDIUM IMPACT)

Add missing indexes for the most frequent query patterns:

```prisma
model Activity {
  @@index([userId, startDate, sportType])  // Stats page multi-filter
  @@index([userId, averageHeartrate])      // Zone classification queries
}

model Message {
  @@index([conversationId, createdAt])     // Chat history loading
}
```

Run `prisma db push` to apply without migration.

---

### Priority 6: Lazy-load heavy chart libraries (LOW EFFORT, SMALL IMPACT)

Recharts is included in the initial bundle. Use dynamic imports for chart-heavy pages:

```typescript
import dynamic from "next/dynamic";

const WeeklyVolumeChart = dynamic(
  () => import("@/components/charts/WeeklyVolumeChart").then(m => ({ default: m.WeeklyVolumeChart })),
  { loading: () => <div className="h-48 bg-surface-2 rounded-xl animate-pulse" />, ssr: false }
);
```

This reduces the initial JS bundle by ~45KB (Recharts) and defers chart rendering until interactive.

---

## 3. Implementation Order

| # | Fix | Effort | Impact | When |
|---|---|---|---|---|
| 1 | **Expand FitnessCache** — cache ATL/CTL/TSB, volumes, zones, predictions | Medium | Huge | Next session |
| 2 | **Skip bestEfforts/splitsMetric in bulk fetch** | Low | Medium | Next session |
| 3 | **Suspense streaming** on Stats page | Medium | Large | After cache |
| 4 | **buildCoachContext uses cache** | Low | Large | With #1 |
| 5 | **DB indexes** | Low | Medium | Quick win |
| 6 | **Lazy-load Recharts** | Low | Small | Any time |

**Most impactful single change:** Expanding `FitnessCache` to include ATL/CTL, weekly volumes, and zone seconds. This eliminates 90% of the computation on the Stats page and coach context.

---

## 4. Quick Wins (Do Now, < 30 min each)

1. **`select: { bestEfforts: false, splitsMetric: false }`** in the Stats page bulk fetch
2. **Add `@@index([userId, startDate, sportType])`** to Activity model
3. **Set `next: { revalidate: 300 }`** on the Stats API route (5-min cache for static-ish data)

---

*Last updated: 2026-05-20*
