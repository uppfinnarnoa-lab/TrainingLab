// Google Calendar's event colorId palette is fixed at exactly these 11 values (see
// https://developers.google.com/calendar/api/v3/reference/colors — the `event` key).
// Hardcoded rather than fetched at runtime: the palette is stable, and this keeps the
// no-SDK raw-fetch approach (lib/google-calendar/client.ts) free of an extra round-trip.
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1":  "#7986CB", // Lavender
  "2":  "#33B679", // Sage
  "3":  "#8E24AA", // Grape
  "4":  "#E67C73", // Flamingo
  "5":  "#F6BF26", // Banana
  "6":  "#F4511E", // Tangerine
  "7":  "#039BE5", // Peacock
  "8":  "#616161", // Graphite
  "9":  "#3F51B5", // Blueberry
  "10": "#0B8043", // Basil
  "11": "#D50000", // Tomato
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Maps a planner hex color to the closest Google Calendar event colorId by RGB distance. */
export function nearestGoogleColorId(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  let best = "1";
  let bestDist = Infinity;
  for (const [id, candidate] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const [cr, cg, cb] = hexToRgb(candidate);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = id; }
  }
  return best;
}
