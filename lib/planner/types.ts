// Shared types for the planner module — matches Prisma shape with JSON-serialized dates.

export interface SportCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
  isRunningRelated: boolean;
  workoutTypes: WorkoutType[];
}

export interface WorkoutType {
  id: string;
  sportId: string;
  name: string;
  color: string | null;
  order: number;
  defaultZone: number | null;
  isShared: boolean;
}

export interface WorkoutSection {
  id: string;
  order: number;
  name: string;
  durationType: "time" | "distance" | "open";
  duration: number | null;     // seconds
  distance: number | null;     // meters
  repetitions: number | null;
  zoneType: string | null;
  targetZone: number | null;   // 1-5
  targetPaceLow: number | null;  // sec/km
  targetPaceHigh: number | null;
  targetHRLow: number | null;
  targetHRHigh: number | null;
  targetRPE: number | null;
  notes: string | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string | null;
  sportId: string;
  typeId: string | null;
  color: string | null;
  estimatedDuration: number | null;
  estimatedDistance: number | null;
  estimatedZoneDistribution: Record<string, number> | null;
  sections: WorkoutSection[];
  sport: SportCategory;
  type: WorkoutType | null;
}

export interface PlannedWorkout {
  id: string;
  date: string;         // YYYY-MM-DD
  name: string;
  sportType: string;
  notes: string | null;
  targetDistance: number | null;
  targetDuration: number | null;
  targetIntensity: string | null;
  color: string | null;
  templateId: string | null;
  typeId: string | null;
  status: "planned" | "completed" | "missed" | "partial";
  missedReason: string | null;
  missedNote: string | null;
  markedAt: string | null;
  template: WorkoutTemplate | null;
  type: WorkoutType | null;
}

export interface TrainingBlock {
  id: string;
  name: string;
  blockType: string;
  color: string;
  startDate: string;
  endDate: string;
  targetRaceId: string | null;
  notes: string | null;
  targetKmPerWeek: number | null;
  targetIntensity: string | null;
  archived: boolean;
  actualKm: number | null;
  actualTimeSec: number | null;
  actualCompletionRate: number | null;
}

// Zone colors shared across planner components
export const ZONE_COLORS: Record<number, string> = {
  1: "#94A3B8",
  2: "#6EE7B7",
  3: "#FBBF24",
  4: "#F97316",
  5: "#EF4444",
};

export const BLOCK_TYPE_COLORS: Record<string, string> = {
  base:    "#3B82F6",
  build:   "#F97316",
  peak:    "#EF4444",
  taper:   "#14B8A6",
  custom:  "#8B5CF6",
  race:    "#FBBF24",
};
