"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!ref.current || typeof window === "undefined") return;

    const container = ref.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;
    // aborted is set true by cleanup before the async import resolves —
    // prevents a second map from being created in the same container (React strict-mode double-invoke)
    let aborted = false;

    import("leaflet").then(L => {
      if (aborted || !container.isConnected) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl:       "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl:     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const coords = decodePolyline(polyline);
      if (coords.length === 0) return;

      map = L.map(container, { zoomControl: true, scrollWheelZoom: false });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "© CartoDB",
        maxZoom: 18,
      }).addTo(map);

      const line = L.polyline(coords, { color, weight: 3, opacity: 0.9 }).addTo(map);
      L.circleMarker(coords[0], { radius: 6, color: "#22C55E", fillColor: "#22C55E", fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker(coords[coords.length - 1], { radius: 6, color: "#EF4444", fillColor: "#EF4444", fillOpacity: 1, weight: 2 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
      // Allow CSS to settle before Leaflet measures the container
      setTimeout(() => { if (!aborted) map?.invalidateSize(); }, 200);
    });

    return () => {
      aborted = true;
      map?.remove();
      map = null;
    };
  }, [polyline, color]);

  return <div ref={ref} style={{ width: "100%", height: "100%", background: "#1a1d27" }} />;
}
