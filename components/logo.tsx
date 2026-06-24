interface Props {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Logo({ size = 32, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="T"
    >
      <defs>
        <mask id="act-cut">
          <rect width="40" height="40" fill="white" />
          <polyline
            points="7,27.5 15,27.5 16.5,27 18.5,22.5 18.8,22.5 21,27.5 22,32.5 23.5,27.5 33,27.5"
            stroke="black"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </mask>
      </defs>
      <path
        d="M2,7 H38 V17 H27 V38 H13 V17 H2 Z"
        className="fill-accent"
        mask="url(#act-cut)"
      />
    </svg>
  );
}

/**
 * Gap between the T-icon and the text that follows it — SVG right margin
 * (2/40=5%) + font left bearing - one letter-width gap, targeting the same
 * visual gap as between "r" and "a" in "rainingLab".
 *
 * Applied as a negative margin on the ICON's trailing edge (see LogoWordmark
 * and Sidebar), not as a negative leading margin on the text itself — a
 * leading negative margin pulls content past its own box's start, which is
 * harmless in a plain flex row but gets clipped if the text is ever wrapped
 * in its own `overflow-hidden` container (e.g. a collapsible sidebar label).
 */
export function logoPullIn(size: number): number {
  return -(size * 0.20);
}

/**
 * Text half of the wordmark, split out so layouts that need to animate
 * the label away (e.g. a collapsible sidebar) can wrap just this part
 * without re-deriving the size math below.
 */
export function LogoText({ size = 32, className }: Props) {
  const fontSize = size * 0.52;

  return (
    <span
      className={`font-semibold tracking-tight text-primary leading-none whitespace-nowrap ${className ?? ""}`}
      style={{ fontSize, paddingBottom: size * 0.03 }}
    >
      raining<span className="text-accent">Lab</span>
    </span>
  );
}

/** Wordmark: [T-icon]rainingLab — the icon IS the "T", text follows with no gap. */
export function LogoWordmark({ size = 32, className }: Props) {
  return (
    <div className={`flex items-end ${className ?? ""}`} style={{ gap: 0 }}>
      <Logo size={size} style={{ marginRight: logoPullIn(size) }} />
      <LogoText size={size} />
    </div>
  );
}
