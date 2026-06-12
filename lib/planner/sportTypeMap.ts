// Maps Strava/legacy Activity.sportType strings to the user's sport category names.
export const STRAVA_SPORT_MAP: Record<string, string> = {
  Run: "Running", VirtualRun: "Running", TrailRun: "Running",
  Ride: "Cycling", VirtualRide: "Cycling", EBikeRide: "Cycling",
  NordicSki: "Skiing", BackcountrySki: "Skiing",
  RollerSki: "Roller Skiing",
  WeightTraining: "Strength", Workout: "Strength",
};
