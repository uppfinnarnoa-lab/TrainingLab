# Implementationsplan: Bucket-estimator — outliers och bin-storlek

_Datum: 2026-05-27_

---

## Fråga 1 — Outlierfiltrering per hink

### Vad algoritmen faktiskt gör med outliers (zones.ts:390–393)

Viktat median: sortera aktiviteter i hinken efter HR stigande, summera vikter tills ≥ 50% av totalvikten uppnås. Medianet är HR-värdet vid den punkten.

**Ditt konkreta exempel: 1 körning @ 160 bpm, 30 körningar @ 130 bpm.**

Med lika vikter: total = 31 vikter, 50%-gräns = 15.5 vikter.  
De 30 körningarna vid 130 bpm ger kumulativ vikt = 30 → redan vid 130 bpm har vi passerat 50%-gränsen.  
Medianen = **130 bpm**. Den enda körningen på 160 bpm har noll effekt.

Viktad variant: om den enda 160-körningen är ny (vikt 0.9) och de 30 äldre har vikt 0.3 var:
- 160-körningens vikt: 0.9
- 30 × 0.3 = 9.0
- 50%-gräns: 9.9/2 = 4.95 → uppnås vid de första 17 körningarna vid 130 bpm
- Medianen = **130 bpm**. Fortfarande noll effekt.

**Slutsats outlierfiltrering:** Det konkreta scenariot är redan löst av medianen utan ytterligare åtgärd. IQR-filtering ovanpå en viktat median ger ingen mätbar förbättring för klassiska outlier-case (enstaka extremvärden). Den enda situation där det _eventuellt_ hjälper — bimodala fördelningar med ~50/50-split av intervallpass vs lätta pass — kan IQR inte lösa ändå, eftersom de två topparna sitter inom 2×IQR av varandra (typiskt 20–25 bpm mellanrum, fence = 40–50 bpm).

**Inga kodändringar för outlierfiltrering.**

---

## Fråga 2 — Mindre bin-storlek

### Nuläge (zones.ts:376)

```ts
const binWidth = Math.max(12, Math.min(30, Math.round(2 * iqr * Math.pow(n, -1 / 3))));
```

Freedman-Diaconis formula. Med ~300 körningar efter OL-fix och IQR ≈ 70 s/km:
- `2 × 70 × 300^(-1/3) ≈ 20 s/km`
- I pace-spannet 200–391 s/km (191 s) → **~9–10 hinkar**

### Vad mindre bins ger

Med 15 s bins i samma spann:
- **~13 hinkar** i genomsnitt, ~23 aktiviteter per hink (300/13) → klart över MIN_COUNT = 10
- Bättre pace-upplösning för LT1/LT2: brytpunkten kan lokaliseras till ±15 s/km istället för ±20 s/km
- Mer svängrum ovanför 8-hinkskravet (13 vs 9 → tryggare marginal)

Med 10 s bins:
- ~19 hinkar, ~16 aktiviteter per hink → knappast ovanför MIN_COUNT = 10 vid glesa tempon, riskabelt

### Kritisk granskning

**Vinner vi R²?** Inte garanterat — fler datapunkter i regressionen innebär fler möjligheter att avvika från modellen. Men med ren data (efter OL-fix) är avvikelserna slumpmässiga, inte systematiska, så R² bör hålla sig stabilt eller förbättras marginellt.

**Risk:** Om aktiviteter är glest spridda vid extremtempon (4:20/km och 6:20/km) kan några hinkar hamna under 10 aktiviteter och droppa ut. Med 15 s bins och ~300 körningar är risken låg men inte noll. Gränsfallet är de snabbaste hinkarna (4:20–4:35/km), som kräver 10 tempolopp/tröskelpass — troligtvis uppfyllt men inte säkerställt.

**Är FD inte adaptiv nog?** FD anpassar sig till IQR för hela pacefördelningen, men IQR speglar trainingsprofilen snarare än var LT-breakpoints behöver finas in. En fast 15 s bin är enklare och ger förutsägbar precision.

**Konklusion:** Byte från FD till fast 15 s bin är en begränsad förbättring med låg risk. Vinsten är bättre LT-upplösning och säkrare marginal mot 8-hinkskravet. Genomförs.

---

## Implementationsplan

**En ändring i `lib/fitness/zones.ts` rad 376:**

```ts
// Nuvarande:
const binWidth = Math.max(12, Math.min(30, Math.round(2 * iqr * Math.pow(n, -1 / 3))));

// Ny:
const binWidth = 15;
```

Fast 15 s/km bin. Tar bort FD-formeln helt — den är adaptiv på ett sätt som inte tillför värde här eftersom vi har ett väldefinierat pace-spann (200–391 s/km) och ett ungefärligt känt antal körningar.

**Förväntad effekt:**
- Antal hinkar: 9–10 → 12–13
- Aktiviteter per hink: ~30 → ~23 (fortfarande robust median)
- LT-precision: ±20 s/km → ±15 s/km
- R²: marginellt bättre eller oförändrat
- Risk: låg — fallback `return null` vid <8 hinkar finns redan

**Ingen ändring för outlierfiltrering** — weighted median hanterar redan det konkreta scenariot korrekt.
