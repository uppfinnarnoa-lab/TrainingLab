// Sport icons from Tabler Icons (MIT) — same stroke-width/linecap/linejoin convention as Lucide,
// so they blend seamlessly with existing navigation icons.
// SVG paths verified against unpkg.com/@tabler/icons@latest/icons/outline/<name>.svg 2026-06-30.
// Color comes from SportCategory.color (passed as prop or via CSS currentColor) — not hardcoded.

interface SportIconProps {
  size?: number;
  color?: string;
  className?: string;
}

function iconBase(size: number, color: string | undefined, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

// Tabler: icon-run — proportional running pose
export function RunIcon({ size = 24, color, className }: SportIconProps) {
  return iconBase(size, color, className, <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <circle cx="13" cy="4" r="1" />
    <path d="M4 17l5 -1.5l2 -4.5" />
    <path d="M15 21l-1 -5l-3 1" />
    <path d="M7 11.5l5 -1.5l3 3l3 1" />
  </>);
}

// Tabler: icon-bike — correct wheel/frame/saddle/handlebar geometry
export function BikeIcon({ size = 24, color, className }: SportIconProps) {
  return iconBase(size, color, className, <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <circle cx="5" cy="15" r="3" />
    <circle cx="19" cy="15" r="3" />
    <path d="M5 15l2 -5h10l1 4" />
    <path d="M13 10l-2 -5" />
    <path d="M10 5l5 0" />
  </>);
}

// Tabler: icon-barbell — barbell with weights, clear at small sizes
export function StrengthIcon({ size = 24, color, className }: SportIconProps) {
  return iconBase(size, color, className, <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M2 12h1" />
    <path d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" />
    <path d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" />
    <path d="M14 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" />
    <path d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" />
    <path d="M22 12h-1" />
  </>);
}

// Tabler: icon-compass — compass with long/short needle and center point.
// Used for orienteering (closest established symbol, no dedicated OL icon in any major library).
export function OrienteeringIcon({ size = 24, color, className }: SportIconProps) {
  return iconBase(size, color, className, <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v2" />
    <path d="M12 19v2" />
    <path d="M3 12h2" />
    <path d="M19 12h2" />
    <path d="M12 12l-3 -4" />
    <path d="M12 12l3 4" />
  </>);
}

// Tabler: icon-ski-jumping — closest available "skiing" icon in Tabler (no nordic/cross-country ski icon exists).
// Same file used for both Skidor and Rullskidor — at 16-24px the exact discipline is not distinguishable.
export function SkiIcon({ size = 24, color, className }: SportIconProps) {
  return iconBase(size, color, className, <>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <circle cx="17" cy="4" r="1" />
    <path d="M3 21l9 -9" />
    <path d="M14 12l1.5 -1.5" />
    <path d="M8 21l5 -5" />
    <path d="M17 5l-3 6l2 3" />
  </>);
}
