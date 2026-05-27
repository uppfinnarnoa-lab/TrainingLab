# Plan: Rensa OL-kontaminering i bucket-estimatorn

_Datum: 2026-05-27 — uppdaterad med domänkunskap från användaren_

## Bakgrund

Bucket-estimatorn (`estimateZonesFromStatisticalAnalysis`) hittar LT1/LT2 via piecewise-regression på median-HR per pace-hink. Kurvan är U-formad → regressionen misslyckas:

| Tempo | avgHR |
|---|---|
| 4:40/km | 147 bpm |
| 5:00/km | 144 bpm |
| 5:20/km | **142 bpm** (lägst) |
| 6:00/km | 144 bpm |
| 6:20/km | 147 bpm |
| 7:00/km | 151 bpm |

**Orsak (bekräftad av användaren):**
- Nästan alla aktiviteter med tempo > 6:30/km är OL-löpningar
- Alla tävlingsaktiviteter är OL-tävlingar **utom** de som går snabbare än ~4:15/km (vägrace)
- OL-löpningar i 7–10 min/km har systematiskt högre HR än väglopp i samma tempo

---

## Slutgiltig plan

### 1. Filtrera callers: ta bort OL-pass och OL-tävlingar

I `cache.ts` och `page.tsx` (båda ställen som anropar `estimateZonesFromStatisticalAnalysis`):

```ts
.filter(a =>
  /run|trail/i.test(a.sportType) &&
  a.averageHeartrate &&
  // Exclude OL by name (SportType "Orienteer" filtreras redan av run|trail)
  !/\bol\b|\borienteringsl|\bskogsl|\bolpass|orienteer/i.test(a.name ?? "") &&
  // Exclude races unless they're fast road races (< 4:15/km avg pace)
  (!a.isRace || (a.averageSpeed != null && 1000 / a.averageSpeed < 255))
)
```

### 2. Pace-cutoff: 6:30/km (390 s/km)

Nuvarande: `p.gap < 600` (10:00/km).  
Ny: `p.gap < 391` (≈6:31/km).

Motivering: Knappt någon valid vägdata förekommer över 6:30/km — det är OL. Cutoff stämmer exakt med domänkunskapen.

### 3. LT1 sanity-check: justera max till 6:20/km (380 s/km)

Nuvarande: `lt1PaceSecPerKm > 500` (8:20/km).  
Ny: `lt1PaceSecPerKm > 380` (6:20/km).

Consistent med ny cutoff — LT1 kan aldrig hittas i en hink som inte finns.

### 4. R²-tröskel: sänk 0.72 → 0.62

En vältränad löpare med ~13 bpm HR-spann (140–153) uppnår sällan 0.72 R² ens med perfekt data. Sanity-checks (LT1 < LT2, HR-intervaller, pace-intervaller) ger tillräcklig biologisk rimlighets-kontroll.

### 5. buckets minimum: behålls på 8

Med ren data i 4:20–6:20/km-spannet → ~8–9 hinkar → klarar minimum utan ändring.

---

## Förväntad dataprofil efter fix

| Hink | Innehåll | Förv. avgHR |
|---|---|---|
| 4:20/km | Tempolopp, tröskellopp | ~150–153 |
| 4:40/km | Tempo + lättare lopp | ~145–148 |
| 5:00/km | Lätta lopp, mestadels | ~142–144 |
| 5:20/km | Lätta lopp | ~140–142 |
| 5:40/km | Lätta lopp | ~140–143 |
| 6:00/km | Easy, recovery | ~138–142 |
| 6:20/km | Easy, recovery | ~138–141 |

Monotont nedåtgående (bortsett från eventuell bump vid 4:20 av intervall-kontaminering).  
Regression bör hitta LT1 runt 5:00–5:20/km och LT2 runt 4:20–4:40/km.

---

## Kvarvarande osäkerheter

- **4:20/km-bump**: 39 pass med avgHR 153 är sannolikt tempo/tröskellopp. Piecewise-regression är robust mot enstaka outlier-hinkar, men om detta är ett systematiskt fenomen (alla intensiva pass loggas i det tempospannet) kan LT2-estimatet hamna lite för lågt.
- **Recency-viktning**: Gamla snabba lopp (>1 år) har låg vikt `exp(-days/180)`. Om löparen inte springer fort på väg längre kan LT2-hinkar vara underrepresenterade viktmässigt.
- **Namn-regex täcker inte namngivna OL-pass utan OL-ord**: "Träning", "Löpning" som OL-pass passerar fortfarande. Riskbedömning: låg — OL-sportType filtreras redan.
