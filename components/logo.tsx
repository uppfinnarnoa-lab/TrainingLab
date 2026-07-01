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
            points="7,27.5 15,27.5 16.5,27 18.5,22.5 18.8,22.5 21,27.5 22,32.5 23.5,27.5 33,27.5"
            stroke="black"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </mask>
      </defs>
      {/* V35: T stem bottom matches text baseline at y=35 */}
      <path
        d="M2,7 H38 V17 H27 V35 H13 V17 H2 Z"
        className="fill-accent"
        mask="url(#wm-cut)"
      />
      {/* x=32: T right edge (40) minus pull-in (8 = 40×0.20); y=35: same as stem bottom */}
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
