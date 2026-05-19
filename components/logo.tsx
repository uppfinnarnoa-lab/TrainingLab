interface Props {
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
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
        fill="#6EE7B7"
        mask="url(#act-cut)"
      />
    </svg>
  );
}

/**
 * Wordmark: [T-icon]rainingLab
 * The icon IS the "T" — text follows immediately with no gap.
 * Negative left margin compensates for the ~5% empty space on the
 * right side of the SVG viewbox after the T shape ends.
 */
export function LogoWordmark({ size = 32, className }: Props) {
  const fontSize   = size * 0.52;
  // Pull 'r' flush against where the T visually ends.
  // SVG viewbox is 40px wide, T right edge at x=38 → 2/40=5% empty on right.
  // Add font's natural letter-spacing (tracking-tight = -0.025em) offset.
  const pullIn = -(size * 0.05) - (size * 0.52 * 0.025);

  return (
    <div className={`flex items-end ${className ?? ""}`} style={{ gap: 0 }}>
      <Logo size={size} />
      <span
        className="font-semibold tracking-tight text-primary leading-none"
        style={{ fontSize, marginLeft: pullIn, paddingBottom: size * 0.03 }}
      >
        raining<span className="text-accent">Lab</span>
      </span>
    </div>
  );
}
