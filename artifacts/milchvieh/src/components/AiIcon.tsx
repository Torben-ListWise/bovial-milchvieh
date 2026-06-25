interface AiIconProps {
  size?: number;
  working?: boolean;
  className?: string;
}

export function AiIcon({ size = 24, working = false, className }: AiIconProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const sparkScale = size / 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {working ? (
        <>
          {/* Outer rotating arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="currentColor"
            strokeWidth={size * 0.065}
            strokeLinecap="round"
            strokeDasharray={`${r * 1.1} ${r * 2.8}`}
            strokeDashoffset={0}
            opacity={0.7}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: "spin-arc 1.1s linear infinite",
            }}
          />
          {/* Inner counter-rotating arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.68}
            stroke="currentColor"
            strokeWidth={size * 0.05}
            strokeLinecap="round"
            strokeDasharray={`${r * 0.7} ${r * 2.2}`}
            strokeDashoffset={0}
            opacity={0.45}
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: "spin-arc 1.6s linear infinite reverse",
            }}
          />
        </>
      ) : (
        /* Idle: soft outer ring */
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="currentColor"
          strokeWidth={size * 0.055}
          opacity={0.25}
          style={{
            animation: "glow-pulse 3s ease-in-out infinite",
          }}
        />
      )}

      {/* Central spark / data node — always visible */}
      <path
        d={`
          M ${cx} ${cy - 7 * sparkScale}
          L ${cx + 2.8 * sparkScale} ${cy - 2.5 * sparkScale}
          L ${cx + 7 * sparkScale} ${cy}
          L ${cx + 2.8 * sparkScale} ${cy + 2.5 * sparkScale}
          L ${cx} ${cy + 7 * sparkScale}
          L ${cx - 2.8 * sparkScale} ${cy + 2.5 * sparkScale}
          L ${cx - 7 * sparkScale} ${cy}
          L ${cx - 2.8 * sparkScale} ${cy - 2.5 * sparkScale}
          Z
        `}
        fill="currentColor"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: working
            ? "spark-pulse 0.75s ease-in-out infinite"
            : "spark-pulse 3.5s ease-in-out infinite",
        }}
      />

      {/* Center dot highlight */}
      <circle
        cx={cx}
        cy={cy}
        r={size * 0.1}
        fill="currentColor"
        opacity={working ? 0.9 : 0.6}
      />
    </svg>
  );
}
