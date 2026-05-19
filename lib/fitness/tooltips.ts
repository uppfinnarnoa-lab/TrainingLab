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
};
