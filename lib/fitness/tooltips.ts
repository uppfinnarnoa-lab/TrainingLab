// Educational tooltip copy for every metric in the statistics dashboard.
// Each entry: what it is, why it matters, and a good range / rule of thumb.

export interface Tooltip {
  title: string;
  what: string;
  why: string;
  range?: string;
}

export const tooltips: Record<string, Tooltip> = {
  atl: {
    title: "ATL — Acute Training Load",
    what: "A 7-day exponential average of your daily training stress. It represents your current fatigue.",
    why: "High ATL means your body is under significant stress right now. It rises fast after hard training and drops quickly with rest.",
    range: "Normal range in heavy training: 60–120. Above 140 is high overreach risk.",
  },
  ctl: {
    title: "CTL — Chronic Training Load",
    what: "A 42-day exponential average of your daily training stress. It represents your fitness base.",
    why: "CTL is slow to build (takes weeks) and slow to lose. This is the number that peaks on race day when you've had a perfect buildup.",
    range: "Recreational athletes: 30–60. Well-trained: 60–90. Elite: 90–140+.",
  },
  tsb: {
    title: "TSB — Training Stress Balance",
    what: "CTL minus ATL. Positive = fresh, negative = carrying fatigue.",
    why: "Your form indicator. You want TSB to be positive on race day — achieved by tapering (cutting volume while keeping intensity).",
    range: "Race in: +5 to +25. Deep training block: −10 to −30 is normal. Below −40: overreaching risk.",
  },
  vo2max: {
    title: "VO2max",
    what: "Maximum oxygen your muscles can consume per minute per kg of body weight (ml/kg/min). Your aerobic engine size.",
    why: "Higher VO2max = higher ceiling for endurance performance. It improves with training, especially intervals and high weekly volume.",
    range: "Untrained: 30–45. Recreational: 45–55. Well-trained: 55–65. Elite: 65–85.",
  },
  vdot: {
    title: "VDOT",
    what: "Jack Daniels' single-number fitness index derived from race performances. Used to set training paces.",
    why: "VDOT links your current race fitness to all training zones. As you improve, your VDOT rises and your paces update automatically.",
    range: "VDOT 50 ≈ 20:00 5K, 41:40 10K, 1:32 HM. Each +1 VDOT ≈ ~30–45 sec faster per 10K.",
  },
  tss: {
    title: "TSS — Training Stress Score",
    what: "A single number representing the total demand of a training session, accounting for both duration and intensity.",
    why: "Lets you compare very different sessions on one scale: an easy 1h run might be 40 TSS; a hard 1h tempo run might be 90 TSS.",
    range: "100 TSS = an all-out 1-hour effort. Aim for 400–600 TSS/week in a normal training block.",
  },
  hrZone: {
    title: "Heart Rate Zones",
    what: "Five intensity bands based on your max and resting HR, from Z1 (very easy) to Z5 (all-out).",
    why: "Training in the right zones drives the right adaptations. Too much time in Z3 is a common mistake — it's hard enough to cause fatigue, but not hard enough to drive top-end gains.",
    range: "Z1–Z2: builds aerobic base. Z3: moderate — use sparingly. Z4: raises threshold. Z5: develops VO2max.",
  },
  polarization: {
    title: "Polarization",
    what: "The percentage of training time spent at easy (Z1–Z2) vs hard (Z4–Z5) intensity, with little time in the moderate zone (Z3).",
    why: "Research shows polarized training (≈80% easy, ≈20% hard) produces better endurance gains than training predominantly in the 'moderate' zone.",
    range: "Target: 75–80% easy, 0–5% moderate, 15–20% hard. Most recreational athletes spend too much time in Z3.",
  },
  paHR: {
    title: "Aerobic Decoupling (Pa:HR)",
    what: "The % drift between your pace-per-HR ratio in the first vs second half of a long run. Low drift = good aerobic fitness.",
    why: "If your HR rises relative to pace in the second half, it means your aerobic system is struggling to maintain the effort. As your base builds, decoupling decreases.",
    range: "< 5%: excellent aerobic base. 5–8%: moderate. > 10%: base needs more work.",
  },
  hrEfficiency: {
    title: "HR Efficiency",
    what: "Your speed per heartbeat — how fast you run for a given heart rate effort on easy runs.",
    why: "Improving cardiac efficiency means your heart delivers more oxygen per beat. It's one of the clearest signs of growing aerobic fitness over months.",
    range: "Look for an upward trend over 3–6 months, not absolute values. A 5% improvement in 3 months is solid.",
  },
  readiness: {
    title: "Readiness Score",
    what: "A composite daily score combining HRV trend (40%), TSB form (30%), sleep score (20%), and resting HR trend (10%).",
    why: "Combines multiple recovery signals into one actionable number. Use it to decide whether to push a quality session or swap it for recovery.",
    range: "80–100: go hard. 60–79: normal training. 40–59: consider reducing intensity. < 40: prioritize recovery.",
  },
  consistency: {
    title: "Consistency Score",
    what: "The percentage of planned sessions you completed in the last 4 weeks.",
    why: "Consistency is the most important long-term performance driver. No single session matters as much as showing up reliably.",
    range: "85%+: elite-level adherence. 70–84%: solid. Below 60%: investigate why sessions are being missed.",
  },
  statZones: {
    title: "Statistical Threshold Estimation",
    what: "LT1/LT2 detected from the breakpoints in your pace-vs-HR curve, using all training data (laps + activities) you have.",
    why: "This is the highest-confidence estimate available — it uses your full history, not a single rolling window — which is why R² here is usually higher than any single month in the LT/AT pace development chart below. If your recent training has too little pace variety to find a breakpoint, this automatically reaches further back in your history instead of guessing — shown as method \"statistical-historical\" when that happens.",
    range: "R² ≥ 0.90: high confidence. 0.80–0.89: medium. Below 0.80: falls back to race-derived or fixed-percentage zones instead.",
  },
  ltPaceTrend: {
    title: "LT/AT Pace Development",
    what: "Each point recomputes LT1/LT2 as if that month were live today, from training data up to that point only — not with hindsight.",
    why: "Confidence is highest for the current month (most data) and for months with a clear, well-supported breakpoint. Months with too little or too ambiguous data show no point at all, rather than a forced guess. For this athlete specifically, race efforts include orienteering — terrain and navigation make pace less consistent than road racing, so sparser historical months are more sensitive to a handful of races than the current, large-sample estimate is.",
    range: "Trust the current point and the overall direction more than any single older month's exact value.",
  },
  vo2maxTrend: {
    title: "VO2max Development",
    what: "Monthly VDOT (a Daniels' Running Formula composite of VO2max, race PBs, and training data, see the VO2max tooltip above) re-estimated as if that month were live today, from training data up to that point only.",
    why: "A rising trend is the clearest single-number summary of improving aerobic fitness over time — short-term dips often track a hard training block or a taper, not a real fitness loss.",
    range: "Trust the overall direction more than any single month's exact value, especially during low-race periods.",
  },
  easyPaceTrend: {
    title: "Aerobic Pace Trend",
    what: "Monthly median Grade-Adjusted Pace (GAP) on easy runs — runs below LT1 HR, ≥ 6 km, and not races. GAP corrects for hills so a hilly route doesn't look slower than a flat one.",
    why: "A downward trend (faster pace at the same easy effort) is the clearest sign that your aerobic base is improving. Needs ≥ 3 qualifying sessions per period to appear.",
    range: "Expect improvement of 10–30 sec/km per year with consistent easy running.",
  },
  hrvTrend: {
    title: "HRV — Heart Rate Variability",
    what: "Nightly HRV (ms), measured by Garmin overnight, plus the status it assigns relative to your personal 5-night rolling baseline.",
    why: "Higher HRV generally means your nervous system is well-recovered. A sustained downward trend over more than 7 days often precedes illness or overtraining by days, before you feel it.",
    range: "Watch the trend, not the absolute number — baselines vary a lot between individuals.",
  },
  sleepTrend: {
    title: "Sleep Stages & Score",
    what: "Hours of deep / light / REM / awake time per night, with Garmin's overall sleep score overlaid.",
    why: "Deep sleep drives physical recovery and growth hormone release. REM sleep drives cognitive function and motor learning. Consistently low deep sleep impairs athletic adaptation even when training load is moderate.",
    range: "Healthy adults: ~13–23% deep, ~20–25% REM. Sleep score 80+: excellent, 60–79: fair, below 60: poor.",
  },
  restingHRTrend: {
    title: "Resting Heart Rate Trend",
    what: "Morning resting heart rate (bpm) from Garmin, over time.",
    why: "A rising resting HR (3–5 bpm above your normal) is an early signal of fatigue, illness, or dehydration. Track your own baseline rather than a generic range.",
    range: "Most trained endurance athletes sit around 40–55 bpm at rest.",
  },
  garminWellness: {
    title: "Body Battery, Stress & Readiness",
    what: "Garmin's own daily scores: Body Battery (0–100 energy reserve, drains through the day and stress, refills with rest/sleep), average daily Stress (0–100, lower is calmer), and Garmin's Training Readiness (0–100, its own composite recovery score).",
    why: "These three together give a quick read on whether today is a good day to push training or back off — independent of TrainingLab's own Readiness score, which blends in TSB and HRV as well.",
    range: "Body Battery 50+: good energy for training. Stress consistently above 60: under-recovered. Training Readiness 70+: ready for a hard session.",
  },
};
