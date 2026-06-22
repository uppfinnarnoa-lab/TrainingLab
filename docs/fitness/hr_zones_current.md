# TrainingLab — Nuvarande beräkning av pulszoner (HR Zones)

Detta dokument beskriver kort och koncist hur pulszonerna (HR-zoner) beräknas i systemet just nu (`lib/fitness/zones.ts`).

---

## 1. Basvärden (Vilopuls och Maxpuls)
*   **Vilopuls (Rest HR)**: Hämtas i prioritetsordning från:
    1. Användarens manuella profil (Inställningar).
    2. Senaste Garmin-sensordatan (nightly resting HR).
    3. Tidigare beräknat cache-värde.
    4. Standardvärde (50 bpm) om inget annat finns.
*   **Maxpuls (Max HR)**: Hämtas i prioritetsordning från:
    1. Användarens manuella profil (Inställningar) – vinner alltid.
    2. Estimat från tävlingspass (80:e percentilen av maxHR från lopp + 5 bpm marginal, cap 210 bpm; kräver ≥2 lopp).
    3. Statistiskt maxHR från hårda löp/trail-pass (80:e percentilen av maxHR på pass med snittpuls > 78 % av observerat max; kräver ≥5 pass).
    4. Estimat från tröskelpass (85:e percentilen av snittpulsen på tröskelpass, dividerat med 0.88; kräver ≥3 pass).
    5. Estimat från övriga aktiviteter (85:e percentilen av maxHR på vanliga pass, hård-cappat vid 190 bpm för att rensa sensorfel).

---

## 2. Tröskelberäkning (LT1 och LT2)
Systemet försöker beräkna de fysiologiska tröskelvärdena **LT1** (aerob tröskel, där laktat börjar stiga) och **LT2** (laktattröskel/anaerob tröskel):

### Metod A: Estimat från tävlingsresultat (Race PBs)
1.  **LT2-tempo** beräknas utifrån bästa tider:
    *   Halvmarathontempo (direkt matchning)
    *   10K-tempo × 1.065 (om inget HM finns)
    *   5K-tempo × 1.135 (om inget 10K/HM finns)
    *   Annars Riegel-extrapolering till 10K-tempo × 1.065.
2.  **LT1-tempo** sätts till 10 % långsammare än LT2-tempo (`LT2-tempo * 1.10`).
3.  **Puls vid trösklarna** beräknas från fasta fysiologiska procentsatser av maxpuls (Seiler 2010): LT1 ≈ 82–83 % av maxpuls, LT2 ≈ 88 % av maxpuls. Pulsen härleds inte från tempo-regression — HR-pace-regression extrapolerad till tröskeltempo överskattar pulsen kraftigt (95–97 % av maxpuls).

### Metod B: Statistisk piecewise-regression (Träningspass)
Kräver minst 8 olika tempogrupper med minst 10 pass i varje:
1.  Träningspass delas in i grupper (bins) efter gradjusterat tempo (GAP).
2.  Medianpulsen beräknas för varje grupp.
3.  En piecewise linjär regression görs för att hitta två brytpunkter (inflection points) i kurvan där pulsresponsen ändras fysiologiskt:
    *   **Brytpunkt 1** = LT1 (Aerob tröskel)
    *   **Brytpunkt 2** = LT2 (Laktattröskel)
4.  Kräver godkänt förklaringsvärde (R² ≥ 0.62) och rimliga pulsvärden (minst 8 bpm separation mellan LT1/LT2, LT1 ≥ 60 % av maxpuls, LT2 ≥ 70 %) för att tillämpas. Se `docs/fitness/hr-zone-statistical-estimation.md` för den fullständiga algoritmbeskrivningen (bucket-vikter, brytpunktssökning, etc).

---

## 3. Zonindelning (HR Zones)
När LT1 och LT2 har beräknats (antingen via tävlingar eller statistik) skapas 5 zoner med **icke-uniforma (olika) bredder** förankrade i trösklarna:

*   **Z1 (Recovery)**: `[restHR, LT1 - z2width]`
*   **Z2 (Aerobic)**: `[LT1 - z2width, LT1]`  *(Aktiv aerob baszon, bredd ca 8-12 bpm)*
*   **Z3 (Tempo)**: `[LT1, LT2]`  *(Zonen mellan trösklarna)*
*   **Z4 (Threshold)**: `[LT2, Math.min(LT2 + 8, maxHR - 2)]`  *(Tröskelträning)*
*   **Z5 (VO2max)**: `[Math.min(LT2 + 8, maxHR - 2), maxHR]`  *(Över tröskel)*

*Bredden för Z2 beräknas som:* `z2width = Math.max(8, Math.round(LT1 * 0.07))`

### Fallback (Procentuell)
Om tröskelberäkningarna ger ogiltiga eller icke-stigande pulsvärden faller systemet tillbaka på fasta procentsatser av maxpuls:
*   LT1 = 83 % av maxpuls
*   LT2 = 89 % av maxpuls
*   Zonerna beräknas därefter med samma formler som ovan.
