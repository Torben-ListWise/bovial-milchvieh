interface KpiTileProps {
  label: string;
  value: number | string;
  unit: string;
  trend?: "up" | "down" | "neutral";
}

export function KpiTile({ label, value, unit, trend }: KpiTileProps) {
  const trendIcon =
    trend === "up" ? (
      <span className="text-green-500 font-bold">▲</span>
    ) : trend === "down" ? (
      <span className="text-red-500 font-bold">▼</span>
    ) : trend === "neutral" ? (
      <span className="text-muted-foreground font-bold">—</span>
    ) : null;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1">
      <div className="flex items-baseline gap-1">
        <span className="text-[28px] font-bold leading-none text-foreground tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
        {trendIcon && <span className="ml-1 text-sm">{trendIcon}</span>}
      </div>
      <span className="text-[12px] text-muted-foreground leading-snug">{label}</span>
    </div>
  );
}
