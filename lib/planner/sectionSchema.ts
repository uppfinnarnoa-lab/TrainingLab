import { z } from "zod";

// Shared by app/api/planner/templates/route.ts and app/api/planner/templates/[id]/route.ts.
export const sectionSchema = z.object({
  order: z.number().int(),
  name: z.string().min(1).max(80),
  durationType: z.enum(["time", "distance", "open"]),
  duration: z.number().int().positive().optional().nullable(),
  distance: z.number().positive().optional().nullable(),
  repetitions: z.number().int().min(1).optional().nullable(),
  zoneType: z.enum(["hr_zone", "pace_zone", "power_zone", "rpe"]).optional().nullable(),
  targetZone: z.number().int().min(1).max(5).optional().nullable(),
  targetPaceLow: z.number().positive().optional().nullable(),
  targetPaceHigh: z.number().positive().optional().nullable(),
  targetHRLow: z.number().int().optional().nullable(),
  targetHRHigh: z.number().int().optional().nullable(),
  targetRPE: z.number().int().min(1).max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  // Rest/recovery segment for interval blocks — see lib/planner/estimate.ts.
  restDurationType: z.enum(["time", "distance"]).optional().nullable(),
  restDuration: z.number().int().positive().optional().nullable(),
  restDistance: z.number().positive().optional().nullable(),
  restTargetZone: z.number().int().min(1).max(5).optional().nullable(),
});
