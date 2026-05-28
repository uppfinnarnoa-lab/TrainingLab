
# Ideas & Backlog

_Datum-format: ÅÅÅÅ-MM-DD. Flytta till archive när implementerat._

---

## HR-zonkalibrering

### 2026-05-28 · Item L — D-max för LT1-detektion i bucket-estimatorn

**Vad**: Ersätt den exhaustive piecewise linear LS-sökningen *för LT1* med **modified D-max** på den utjämnade HR:pace-kurvan.

**Varför**: LS-estimatorn är matematiskt bimodal när sluttpunktsförändringen är liten (Baek 2018, arxiv:1811.03720). LT1-knicket är bara ~10–15% lutningsförändring → LS drar breakpointen mot den täta easy-zonen snarare än den verkliga tröskeln. LT2 är opåverkad (stor lutningsförändring).

**Algoritm**:
1. Fitta polynom (grad 3–4) på buckettade HR:pace-punkter (monotona efter PAV)
2. Dra en linje från första till sista bucketen
3. LT1 = punkten med maximalt vinkelrätt avstånd från den linjen
4. LT2 behåller befintlig LS-sökning

**Evidens**: PMC20508457; Jang & Ko (2017, Semantic Scholar) — D-max bättre limits-of-agreement mot referensmetoder än bi-segmented regression.

**Fil**: `lib/fitness/zones.ts` → `estimateZonesFromStatisticalAnalysis()`, ersätt breakpoint-loopen för LT1.

---

### 2026-05-28 · Tanaka-formel som UI-hint i Settings

**Vad**: När `dateOfBirth` är satt i AthleteProfile, visa `208 − 0.7 × ålder` som informationstext bredvid maxHR-fältet i Settings.

**Exempel**: "Åldersformel (Tanaka): 183 bpm" i muted text under inputfältet.

**Varför inte automatisk korrigering**: Tanaka ±18 bpm 95% CI — för stor individuell variation. Se arkiverad `bucket-estimator-improvements.md` Item D för fullständig analys.

**Fil**: `app/(dashboard)/settings/page.tsx` — beräkna och rendera som hjälptext, ingen logikändring.

---

### 2026-05-28 · CS som valideringssignal för LT1

**Vad**: Critical Speed (CS) ligger nära LT2/MLSS. Eftersom VT1/VT2-hastighetskvot ≈ 0.844, bör LT1-hastigheten ligga i [CS × 0.77, CS × 0.91]. Om bucket-estimatorn returnerar ett LT1 utanför detta intervall → visa varning i kalibreringspanelen.

**Exempel**: "LT1 estimate may be inaccurate — considerably below CS-derived range. Consider manual calibration."

**Fil**: `lib/fitness/cache.ts` → `updateHRZones()`, lägg till sanity-check mot `criticalSpeedMs`.

---

## Stats & visualisering

### 2026-05-27 · Backfill HR-estimat och zonkurva

**Vad**: Kör HR-zonkalibreringen retroaktivt — beräkna vad LT1/LT2 och zonerna *var* vid varje historisk tidpunkt (rullande 6-månadersfönster bakåt). Visa som tidsserie: hur har LT1-HR, LT2-HR och maxHR förändrats över åren.

**Varför**: Ger historisk bild av aerob utveckling utöver VO2max-estimatet. Komplementär signal — LT1 stiger relativt maxHR vid aerob förbättring.

**Datakvalitet**: Kräver tillräckligt med löpdata per period (≥ 40 runs för bucket-estimatorn). Kan vara sparse för tidiga år.

**Implementation**:
- Ny funktion i `lib/fitness/cache.ts` eller separat fil
- Iterera bakåt i 3-månaderssteg, kör `estimateZonesFromStatisticalAnalysis` på data t.o.m. varje datum
- Cacha resultaten i `FitnessCache.extraViz` (JSON-fält)
- Ny visualisering på stats-sidan: linjediagram LT1-HR, LT2-HR, maxHR över tid

---
