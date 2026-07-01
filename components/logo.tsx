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
            points="7,23 15,23 17,17 19,17 21,29 23,29 25,23 33,23"
            stroke="black"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </mask>
      </defs>
      {/* stem ends at y=35 — when placed next to text in a flex items-end row,
          T visual bottom lands at the text's typographic baseline (~0.3 px off) */}
      <path
        d="M1,5 H39 V14 H25 V35 H15 V14 H1 Z"
        className="fill-accent"
        mask="url(#act-cut)"
      />
    </svg>
  );
}

export function logoPullIn(size: number): number {
  return -(size * 0.20);
}

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

/**
 * Wordmark rendered as a single SVG — SVG coordinates control alignment
 * directly so there is no CSS flex layout involved.
 *
 * T stem ends at y=35; SVG text baseline sits at y=35.
 * Both share the same typographic floor by construction.
 *
 * ViewBox width 148 covers the T icon (40 units) + pull-in (-8) + "rainingLab"
 * at font-size 20.8 SVG units (= size×0.52 scaled to 40-unit height).
 * If text is clipped on screen: increase W and adjust width prop accordingly.
 */
export function LogoWordmark({ size = 32, className }: Props) {
  const W = 148;
  return (
    <svg
      viewBox={`0 0 ${W} 40`}
      height={size}
      width={Math.round(size * W / 40)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="TrainingLab"
    >
      <defs>
        <mask id="wm-cut">
          <rect width="40" height="40" fill="white" />
          <polyline
            points="7,23 15,23 17,17 19,17 21,29 23,29 25,23 33,23"
            stroke="black"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </mask>
      </defs>
      <path
        d="M1,5 H39 V14 H25 V35 H15 V14 H1 Z"
        className="fill-accent"
        mask="url(#wm-cut)"
      />
      {/* x=32: T right edge (40) minus pull-in (8 = 40×0.20)
          y=35: text baseline — same y as T stem bottom above */}
      <text
        x="32"
        y="35"
        fontSize="20.8"
        fontFamily="Inter, sans-serif"
        fontWeight="600"
        fill="currentColor"
        className="text-primary tracking-tight"
      >
        raining<tspan fill="currentColor" className="text-accent">Lab</tspan>
      </text>
    </svg>
  );
}
