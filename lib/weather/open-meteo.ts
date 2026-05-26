/**
 * Open-Meteo Historical Weather API client.
 * Free, no API key required. Returns hourly data; we select the hour
 * closest to the activity start time.
 * https://open-meteo.com/en/docs/historical-weather-api
 */

import { prisma } from "@/lib/db/prisma";

export interface WeatherSnapshot {
  tempC: number;
  windKph: number;
  precipMm: number;
  weatherCode: number;
  condition: string;
}

// WMO Weather Code → human-readable condition
function decodeWeatherCode(code: number): string {
  if (code === 0)              return "Clear sky";
  if (code <= 2)               return "Partly cloudy";
  if (code === 3)              return "Overcast";
  if (code <= 49)              return "Fog";
  if (code <= 57)              return "Drizzle";
  if (code <= 67)              return "Rain";
  if (code <= 77)              return "Snow";
  if (code <= 82)              return "Rain showers";
  if (code <= 86)              return "Snow showers";
  if (code <= 99)              return "Thunderstorm";
  return "Unknown";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function fetchHistoricalWeather(
  lat: number,
  lng: number,
  dateUtc: Date,
): Promise<WeatherSnapshot | null> {
  const dateStr = toDateStr(dateUtc);
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude",  String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date",   dateStr);
  url.searchParams.set("hourly", "temperature_2m,wind_speed_10m,precipitation,weathercode");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "UTC");

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) return null;

    const json = await res.json() as {
      hourly?: {
        time: string[];
        temperature_2m: number[];
        wind_speed_10m: number[];
        precipitation: number[];
        weathercode: number[];
      };
    };

    const hourly = json.hourly;
    if (!hourly || hourly.time.length === 0) return null;

    // Pick closest hour to activity start time
    const activityHour = dateUtc.getUTCHours();
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const h = new Date(hourly.time[i] + "Z").getUTCHours();
      const diff = Math.abs(h - activityHour);
      if (diff < minDiff) { minDiff = diff; closestIdx = i; }
    }

    const tempC      = hourly.temperature_2m[closestIdx] ?? 0;
    const windKph    = hourly.wind_speed_10m[closestIdx] ?? 0;
    const precipMm   = hourly.precipitation[closestIdx]  ?? 0;
    const weatherCode = hourly.weathercode[closestIdx]   ?? 0;

    return { tempC, windKph, precipMm, weatherCode, condition: decodeWeatherCode(weatherCode) };
  } catch {
    return null;
  }
}

/**
 * Fetch weather for an activity and persist it to the DB.
 * Called fire-and-forget from sync — never throws.
 */
export async function fetchAndSaveWeather(
  activityId: string,
  lat: number,
  lng: number,
  dateUtc: Date,
): Promise<void> {
  const snapshot = await fetchHistoricalWeather(lat, lng, dateUtc);
  if (!snapshot) return;

  await prisma.activity.update({
    where: { id: activityId },
    data: {
      weatherTemp:   snapshot.tempC,
      weatherWind:   snapshot.windKph,
      weatherPrecip: snapshot.precipMm,
      weatherCode:   snapshot.weatherCode,
    },
  });
}
