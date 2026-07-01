// lib/ai/training-science-reference.ts
// Curated, app-maintained reference for recurring physiological adjustment questions.
// These are applied "rules of thumb" from the cited consensus literature, not measured
// values for any specific athlete — the coach must present them as estimates and prefer
// the athlete's own historical data (via search_activities/compare_activities) when available.

export const TRAINING_SCIENCE_REFERENCE = {
  heat: {
    topic: "Heat adaptation and pace adjustment",
    guidance: [
      "Above ~15°C, expect a measurable pace decrement at the same HR/effort for a non-heat-acclimatized athlete; the effect accelerates non-linearly above ~25°C, more so with high humidity.",
      "Commonly cited applied range for a non-acclimatized athlete at threshold effort: roughly +1 to +3 sec/km pace adjustment per °C above 15°C, upper end of the range at high humidity. Treat as a rough planning estimate, not a precise constant.",
      "HR at a given pace commonly runs ~10-15 bpm higher above 25°C versus under 15°C for non-acclimatized athletes.",
      "10-14 days of repeated heat exposure (heat acclimatization) meaningfully narrows this gap — always note whether the athlete is acclimatized when applying these numbers.",
    ],
    citeAs: "Applied heat-performance guidance (consensus literature on heat and athletic performance, e.g. Racinais et al. 2015; ACSM heat-illness guidance) — present as an estimate, not a measured value for this athlete.",
  },
  altitude: {
    topic: "Altitude adaptation and pace adjustment",
    guidance: [
      "Below ~1,500m, performance effects are typically negligible for most athletes.",
      "Above ~1,500-2,000m, expect a roughly 1-3% pace/power decrement per 300m of additional elevation at the same effort for a non-acclimatized athlete, more pronounced for higher-intensity efforts (VO2max-dependent work) than for easy aerobic pace.",
      "Full acclimatization typically takes 1-3 weeks depending on altitude; the first 3-5 days often feel disproportionately hard before partial adaptation.",
    ],
    citeAs: "Applied altitude-performance guidance (consensus exercise-physiology literature on hypoxia and endurance performance) — present as an estimate, not a measured value for this athlete.",
  },
  taper: {
    topic: "Taper volume/intensity guidance before a goal race",
    guidance: [
      "Typical evidence-based taper: reduce volume 40-60% over 1-3 weeks while maintaining (not cutting) intensity — frequency and some high-intensity work preserve fitness better than volume does.",
      "Longer tapers (2-3 weeks) suit longer/harder training blocks (marathon, high weekly volume); shorter tapers (4-10 days) suit shorter races off lower volume.",
    ],
    citeAs: "Applied taper guidance (Bosquet et al. 2007 meta-analysis on tapering and performance, and related consensus literature).",
  },
} as const;

export type TrainingScienceTopic = keyof typeof TRAINING_SCIENCE_REFERENCE;
