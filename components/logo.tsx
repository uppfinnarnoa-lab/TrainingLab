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
      <path d="M18.5,23.3 19.2,21.3 20.8,26.6 22.3,26.6 23.3,23.3 25.3,23.3 25.3,35 15.9,35 16,23.3 Z" className="fill-accent" />
      <path d="M15.9,21.7 17.4,21.7 18.5,18.5 20,18.5 21.6,23.7 22.2,21.7 25.3,21.7 25.3,11.4 37.7,11.4 37.7,2 3.6,2 3.6,11.4 15.9,11.4 Z" className="fill-accent" />
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
      <path d="M18.5,23.3 19.2,21.3 20.8,26.6 22.3,26.6 23.3,23.3 25.3,23.3 25.3,35 15.9,35 16,23.3 Z" className="fill-accent" />
      <path d="M15.9,21.7 17.4,21.7 18.5,18.5 20,18.5 21.6,23.7 22.2,21.7 25.3,21.7 25.3,11.4 37.7,11.4 37.7,2 3.6,2 3.6,11.4 15.9,11.4 Z" className="fill-accent" />
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
