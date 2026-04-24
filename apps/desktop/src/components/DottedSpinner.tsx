type Props = {
  size?: number;
  className?: string;
};

const DOT_COUNT = 8;
const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => i);

export function DottedSpinner({ size = 14, className = "" }: Props) {
  const radius = size / 2 - 1;
  const center = size / 2;
  const dotSize = Math.max(1, size / 10);

  return (
    <span
      role="status"
      aria-label="running"
      className={`inline-block animate-spin ${className}`}
      style={{ width: size, height: size, color: "var(--color-app-accent)" }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {DOTS.map((i) => {
          const angle = (i / DOT_COUNT) * 2 * Math.PI - Math.PI / 2;
          const cx = center + radius * Math.cos(angle);
          const cy = center + radius * Math.sin(angle);
          const opacity = 0.2 + (0.8 * i) / (DOT_COUNT - 1);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={dotSize}
              fill="currentColor"
              opacity={opacity}
            />
          );
        })}
      </svg>
    </span>
  );
}
