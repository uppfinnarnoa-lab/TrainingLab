# Statistisk tröskelestimering — hur det fungerar och varför det nu funkar

## Vad estimatorn gör

Estimatorn analyserar lap-splits från Strava-aktiviteter och beräknar LT1 och LT2 utan att använda maxHR-procent. Stegen:

1. **Datainsamling**: Samlar alla laps ≥ 800 m och ≥ 3 min med HR-data, exklusive orientering/inomhus.

2. **Tempo-buckets**: Gruppar laps i ~15 s/km-breda tempo-buckets (400–700 m/min). Varje bucket representerar ett typiskt ansträngningstempo.

3. **P80-HR per bucket**: Tar 80:e percentilen av HR-värdena i varje bucket (count-baserat, ej viktat). Det ger det representativa "taket" för det tempot utan att enstaka utliggare dominerar.

4. **Bucketvikter**: Varje bucket viktas baserat på antal laps, recency (exponentiellt) och race-boost (×3). Buckets med lite data påverkar analysen mindre.

5. **Joint 3-segment LS**: En dubbel loop hittar globalt optimala brytp­unkter (bp1, bp2) som minimerar totalt kvadratfel för tre linjära segment i tempo→HR-kurvan. bp1 = LT2-omslaget (där kurvan böjer uppåt kraftigt), bp2 = toppen.

6. **LT2**: HR och tempo vid bp1.

7. **LT1 via VT1/VT2-ratio**: LT1-tempo = LT2-tempo / 0.844 (från PMC12845794, n=1 411). LT1-HR interpoleras linjärt ur bucket-arrayen vid det tempot.

8. **Zonbredder**: Z2-bredd = max(8, round(lt1HR × 0.07)) — samma formel som `buildHRZonesFromLT`.

## Skillnad mot % av maxHR

| | Statistisk | % av maxHR |
|---|---|---|
| Datakälla | Dina faktiska laps | Bara maxHR |
| LT2-metod | Piecewise LS i tempo-HR-data | maxHR × 0.88 |
| LT1-metod | VT1/VT2-ratio från LT2-tempo | maxHR × 0.83 |
| Anpassning | Individuell, uppdateras med träning | Statisk formel |
| Konfidensindikator | R² | Ingen |

% av maxHR är ett schablonvärde. Statistisk estimering utnyttjar att din kropp har en faktisk HR-tempoRelation som bryts vid LT1 och LT2.

> Notera: att LT2=162 = 88% av maxHR=184 är inte ett formularesultat — det är fysiologiskt förväntat. LT2 ≈ 88% maxHR stämmer för vältränade löpare. Matchningen validerar att estimatorn ger rätt svar.

## Vad som var trasigt och varför

### 1. `zoneProximity`-vikten (avgörande bugg)

Vikten `zoneProximity = hrFrac >= 0.62 && hrFrac <= 0.85 ? 1.5 : 0.75` applicerades *inne i* den viktade P80-beräkningen. Det down-viktade laps med hög HR (>85% maxHR) i varje bucket, vilket systematiskt drog ner bucket-HR med ~15 bpm i alla tempobuckets. Resultatet: estimerade LT1 och LT2 var 10–20 bpm för låga.

**Fix**: Vikten togs bort helt. Den hade ingen principiellt motiverad grund.

### 2. Viktad P80 (fel statistisk definition)

Kumulativ viktad summa för att hitta P80 är en annan percentil än count-baserad P80 när vikterna varierar. Kombinerat med zoneProximity gav det kraftigt skeva värden.

**Fix**: Count-baserad P80 — sorterar HR-arrayen och tar index `floor(n × 0.80)`.

### 3. Sekventiell 2-segment + D-max LT1

Tidigare: hitta LT2 med 2-segment LS, sedan D-max-algoritm för LT1 relativt LT2-segmentet. D-max är känsligt för brus och ger inkonsistenta resultat när datasetet är litet.

**Fix**: Joint 3-segment LS i en loop — hittar globalt optimalt brytp­unktpar simultant. VT1/VT2-ratio ger sedan LT1-tempo ur LT2-tempo, vilket är fysiologiskt välgrundat.

### 4. Cooldown-filter (blockerade all data)

`isHardActivity = actMaxHR > maxHR × 0.87` klassade nästan alla löprundor som "hård aktivitet" och filtrerade sedan bort alla laps under 80% maxHR — exakt de lugna laps som är mest informativa för LT1.

**Fix**: Filtret togs bort från `cache.ts` (båda cache-paths) och `page.tsx` (slow path).

### 5. Z2-breddsformel

`max(4, round((lt2-lt1) × 0.12))` gav 4 bpm istf korrekt ~11 bpm.

**Fix**: Använder nu `max(8, round(lt1HR × 0.07))` — samma formel som `buildHRZonesFromLT`.

### 6. `statZonesLapsJson` skrevs inte vid manuell kalibrering

`updateHRZones` (manuell kalibrering) saknade beräkning och skrivning av `statZonesLapsJson`.

**Fix**: `statLapOnlyResult` beräknas och skrivs i `updateHRZones`-upserten.

## Varför laps-only är bättre än combined

Activity-nivå-data (ett genomsnittsvärde per löprunda) blandar ihop uppvärmning, cool-down och olika intensiteter i ett enda datapunkt. Lap-splits ger precision — varje datapunkt är ett faktiskt segment med homogen intensitet. Det ger tätare bucket-täckning och bättre definierade brytp­unkter i piecewise-regressionen.
