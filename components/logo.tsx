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
      {/* Background */}
      <rect width="40" height="40" rx="9" fill="#1A1D27" />
      {/* Bold crossbar */}
      <rect x="4" y="9" width="32" height="7" rx="1.5" fill="#6EE7B7" />
      {/* Stem upper */}
      <rect x="17" y="16" width="6" height="7" fill="#6EE7B7" />
      {/* Stem lower */}
      <rect x="17" y="29" width="6" height="7" rx="1.5" fill="#6EE7B7" />
      {/* Cutout window */}
      <rect x="17" y="23" width="6" height="6" fill="#1A1D27" />
      {/* Pulse line through cutout */}
      <polyline
        points="17,26 18.5,24 20,29 21.5,24 23,26"
        stroke="#6EE7B7"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
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
