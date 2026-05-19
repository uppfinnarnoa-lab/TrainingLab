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
      aria-label="TrainingLab"
    >
      <rect width="40" height="40" rx="9" fill="#1A1D27" />
      <polyline
        points="4,16 9,16 13,5 17,25 21,16 36,16"
        stroke="#6EE7B7"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="20.5" y1="16"
        x2="20.5" y2="36"
        stroke="#6EE7B7"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LogoWordmark({ size = 32, className }: Props) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <Logo size={size} />
      <span
        className="font-semibold tracking-tight text-primary"
        style={{ fontSize: size * 0.55 }}
      >
        Training<span className="text-accent">Lab</span>
      </span>
    </div>
  );
}
