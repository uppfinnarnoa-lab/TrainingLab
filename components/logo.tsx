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
      <defs>
        <mask id="act-cut">
          <rect width="40" height="40" fill="white" />
          {/* Activity waveform — sharp corners (miter + butt) */}
          <polyline
            points="14,27.5 16,27.5 17.5,27 19.5,23 19.8,23 21.5,27 23.5,32 25,27.5 29,27.5"
            stroke="black"
            strokeWidth="2.8"
            strokeLinecap="butt"
            strokeLinejoin="miter"
            fill="none"
          />
        </mask>
      </defs>
      {/*
        T drawn as one combined path so crossbar+stem are seamless.
        Crossbar: y=7–17. Stem: y=16–38 (1px overlap eliminates the gap).
      */}
      <path
        d="M2,7 H38 V17 H27 V38 H13 V17 H2 Z"
        fill="#6EE7B7"
        mask="url(#act-cut)"
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
