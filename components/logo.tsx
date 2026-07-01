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
      <path d="M18.0,25.9 18.9,23.9 20.9,29.2 22.8,29.2 24.1,25.9 26.7,25.9 26.7,35 14.6,35 14.7,25.9 Z" className="fill-accent" />
      <path d="M14.6,24.3 16.5,24.3 18.0,21.1 19.9,21.1 21.9,26.3 22.7,24.3 26.7,24.3 26.7,14.0 37.7,14.0 37.7,2 3.6,2 3.6,14.0 14.6,14.0 Z" className="fill-accent" />
    </svg>
  );
}

export function logoPullIn(size: number): number {
  return -(size * 0.27);
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
  const W = 145;
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
      <path d="M18.0,25.9 18.9,23.9 20.9,29.2 22.8,29.2 24.1,25.9 26.7,25.9 26.7,35 14.6,35 14.7,25.9 Z" className="fill-accent" />
      <path d="M14.6,24.3 16.5,24.3 18.0,21.1 19.9,21.1 21.9,26.3 22.7,24.3 26.7,24.3 26.7,14.0 37.7,14.0 37.7,2 3.6,2 3.6,14.0 14.6,14.0 Z" className="fill-accent" />
      <text
        x="29"
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
