"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import "leaflet/dist/leaflet.css";

interface Props {
  polyline: string;
  color: string;
}

// Decode Google Encoded Polyline
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b: number;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function ActivityMap({ polyline, color }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!ref.current || typeof window === "undefined") return;

    const container = ref.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;
    let aborted = false;
    let observer: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    import("leaflet").then(L => {
      if (aborted || !container.isConnected) return;

      const coords = decodePolyline(polyline);
      if (coords.length === 0) return;

      map = L.map(container, { zoomControl: true, scrollWheelZoom: false });
      const tileTheme = resolvedTheme === "light" ? "light_all" : "dark_all";
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}{r}.png`, {
        attribution: "© CartoDB",
        maxZoom: 18,
      }).addTo(map);

      const line = L.polyline(coords, { color, weight: 3, opacity: 0.9 }).addTo(map);
      L.circleMarker(coords[0], { radius: 6, color: "#22C55E", fillColor: "#22C55E", fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker(coords[coords.length - 1], { radius: 6, color: "#EF4444", fillColor: "#EF4444", fillOpacity: 1, weight: 2 }).addTo(map);

      const bounds = line.getBounds();
      map.fitBounds(bounds, { padding: [20, 20] });

      // Production pages settle slowly (fonts, layout, images). fitBounds() uses
      // the container size at call time; if that size was wrong, the tiles load for
      // the wrong viewport and appear fragmented. Fix: re-invalidate AND re-fit at
      // increasing intervals so the view is recalculated against the true container
      // size once layout is stable. After refitsLeft is exhausted we only invalidate
      // (so user pan/zoom isn't overridden after they interact with the map).
      let refitsLeft = 3;
      const invalidate = () => {
        if (aborted || !map) return;
        map.invalidateSize();
        if (refitsLeft > 0) {
          refitsLeft--;
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      };

      timers.push(setTimeout(invalidate, 100));
      timers.push(setTimeout(invalidate, 500));
      timers.push(setTimeout(invalidate, 1500));

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(invalidate);
        observer.observe(container);
      }
    });

    return () => {
      aborted = true;
      timers.forEach(clearTimeout);
      observer?.disconnect();
      map?.remove();
      map = null;
    };
  }, [polyline, color, resolvedTheme]);

  return <div ref={ref} style={{ width: "100%", height: "100%", minHeight: 320, background: "var(--surface-2)" }} />;
}
