# AI Context Schema

This is the source-of-truth for what gets sent to the AI coach. Any change here must be reflected in `lib/ai/context-builder.ts` and `lib/ai/prompts.ts`.

## System prompt (cached in every request)

Built by `buildSystemPrompt(ctx: CoachContext)` in `lib/ai/prompts.ts`.

### CoachContext fields

| Field | Source | Description |
|---|---|---|
| `name` | `User.name` | Athlete display name |
| `age` | `AthleteProfile.dateOfBirth` | Computed at request time |
| `sex` | `AthleteProfile.sex` | `male \| female \| other \| null` |
| `weightKg` | `AthleteProfile.weightKg` | Used for running power estimation |
| `heightCm` | `AthleteProfile.heightCm` | Supplementary |
| `primaryGoal` | `AthleteProfile.primaryGoal` | Shapes coach personality |
| `yearsTraining` | `AthleteProfile.yearsTraining` | Experience context |
| `vo2max` | Computed — 3 methods | ml/kg/min |
| `vo2maxConfidence` | Computed | `high \| medium \| low` |
| `vo2maxMethod` | Computed | Which method gave the estimate |
| `vdot` | Computed (≈ vo2max for running) | Daniels index |
| `ctl` | Computed from TSS curve | Chronic Training Load (42-day EWA) |
| `atl` | Computed from TSS curve | Acute Training Load (7-day EWA) |
| `tsb` | `ctl - atl` | Training Stress Balance |
| `tsbLabel` | Computed | `Fresh \| Neutral \| Tired \| Very tired` |
| `maxHR` | `AthleteProfile.maxHeartRate` or estimated | bpm |
| `restHR` | `AthleteProfile.restingHeartRate` or Garmin | bpm |
| `paces.easy` | Computed from VDOT | Formatted pace range string |
| `paces.marathon` | Computed from VDOT | |
| `paces.threshold` | Computed from VDOT | |
| `paces.interval` | Computed from VDOT | |
| `hrZones` | Computed from maxHR/restHR | Array of 5 [lo,hi] bpm pairs |
| `healthLog` | Garmin + missed workouts | Formatted multi-line string |
| `upcomingRaces` | (future: from TrainingBlock) | Currently empty array |
| `upcomingPlan` | `PlannedWorkout` next 14 days | Formatted string per day |

### healthLog content (when Garmin connected)
- HRV: 7-day trend as `52→49→47 ms ⚠ declining`
- Sleep average: `7.2h/night`
- Body Battery: latest value
- Missed sessions: count and reason categories

## Per-message context (dynamic, not cached)

Built by `buildRecentActivitiesSummary(userId, 28)` in `lib/ai/context-builder.ts`.

One line per activity (last 28 days, max 30 activities):
```
Mon 14 Oct: Threshold run — Run 12.3km 55:00 · 162bpm avg · 4:28/km · 14°C
  Notes: "Felt strong in the second half, knee didn't bother me today"
```

**Fields included:** date, name, sportType, distance, duration, avgHR, avgPace (running only), weatherTemp, isRace flag, description (first 200 chars).

**Fields NEVER sent:** polyline, raw splits arrays, lap data, per-second streams, full bestEfforts JSON.

## What is never sent

- Raw activity streams (GPS coordinates, per-second HR/pace)
- Full `splitsMetric` or `laps` JSON arrays
- Activities older than 28 days (only summary stats used for fitness metrics)
- API keys, passwords, session tokens
- Other users' data
