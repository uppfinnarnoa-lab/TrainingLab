// Open-Meteo historical weather API — free, no key required
const BASE = "https://archive-api.open-meteo.com/v1/archive";

export interface WeatherData {
  temp: number | null;     // °C at activity hour
  wind: number | null;     // km/h
  precip: number | null;   // mm
  code: number | null;     // WMO weather code
}

export async function fetchWeather(
  lat: number,
  lon: number,
  date: Date
): Promise<WeatherData> {
  const dateStr = date.toISOString().split("T")[0];
  const hour = date.getUTCHours();

  const url = new URL(BASE);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("hourly", "temperature_2m,wind_speed_10m,precipitation,weather_code");
  url.searchParams.set("timezone", "UTC");

  const res = await fetch(url.toString(), { next: { revalidate: false } });
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);

  const data = await res.json();
  const h = data.hourly;

  return {
    temp:   h?.temperature_2m?.[hour] ?? null,
    wind:   h?.wind_speed_10m?.[hour] ?? null,
    precip: h?.precipitation?.[hour] ?? null,
    code:   h?.weather_code?.[hour] ?? null,
  };
}
