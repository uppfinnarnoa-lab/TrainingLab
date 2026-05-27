# Notes — Buggar & idéer

_Datum-format: ÅÅÅÅ-MM-DD. En rad per post. Flytta till archive när löst._

---

## Buggar

<!-- exempel: 2026-05-26 · [BUG] Tooltip på stats-sidan försvinner vid hover på kanten -->

---

## Idéer / features

2026-05-27 · [IDEA] Easy run pace trend-statistik

**Vad**: Visa hur easy run-tempo (GAP-justerat) förändrats över tid — ett mått på aerob adaption.

**Varför det är intressant**: Om tempot vid samma HR sjunker (= du springer snabbare för samma ansträngning) syns aerob förbättring. Komplement till VO2max-estimat som är brus-känsligare.

**Definition easy run**: `avgHR < LT1` (Z1+Z2), distans ≥ 6 km, ej tävling.

**Metric**: Viktad median GAP (grade-adjusted pace) per månad/kvartal för qualifying-löpningar. Sekundärt: "aerob effektivitet" = pace/HR (lägre = bättre).

**Datakvalitet**: Ja, tillräckligt om användaren har ≥ 2 år data. Kräver:
- Korrekt LT1-estimat för att klassificera "easy" rätt
- GAP-korrigering för terräng
- Säsongsfiltrar (varma sommardagar höjer HR = missar easy-klassning → väderdata är redan inläst)
- Minst 3 qualifying-pass per period för att perioden ska visas

**Implementation**:
- Ny sektion på stats-sidan: "Aerobic pace trend"
- Linjediagram: x=tid (månadsvis, senaste 3 år), y=median GAP (sec/km) för easy-löpningar
- Overlay: genomsnittlig HR för perioden (sekundär axel, dämpad)
- Visa trend-linje (linjär regression) för att se riktning
- Toggle: visa per kvartal istället för månad vid lång period

**Varning**: Systematisk förändring i löpterräng (fler backar = långsammare GAP trots samma form) kan se ut som regression. Bör noteras i UI.

<!-- exempel: 2026-05-26 · [IDEA] Visa träningsbelastning som heatmap per månad -->

---

## Övrigt
Väderstatistik
Backfill - Hr estimat och kurva going back