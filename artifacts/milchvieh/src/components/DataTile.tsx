import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  betrieb: "Betrieb",
  wetter: "Wetter",
  molkerei: "Molkerei",
  extern: "Extern",
};

const SOURCE_COLORS: Record<string, string> = {
  betrieb: "bg-chart-1/15 text-chart-1",
  wetter: "bg-chart-3/15 text-chart-3",
  molkerei: "bg-chart-4/15 text-chart-4",
  extern: "bg-muted text-muted-foreground",
};

const STATUS_BORDER: Record<string, string> = {
  normal: "border-border",
  warning: "border-chart-4",
  critical: "border-chart-5",
};

const STATUS_BG: Record<string, string> = {
  normal: "",
  warning: "bg-chart-4/[0.04]",
  critical: "bg-chart-5/[0.04]",
};

export interface DataTileProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  source?: "betrieb" | "wetter" | "molkerei" | "extern";
  status?: "normal" | "warning" | "critical";
  basis?: string;
  className?: string;
}

export function DataTile({
  label,
  value,
  unit,
  trend,
  source,
  status = "normal",
  basis,
  className,
}: DataTileProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card flex flex-col justify-between gap-2 px-5 py-4 min-h-[96px]",
        STATUS_BORDER[status] ?? "border-border",
        STATUS_BG[status],
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground leading-snug">
          {label}
        </p>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[2rem] font-semibold leading-none text-foreground tabular-nums"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {value}
          </span>
          {unit && (
            <span className="text-sm text-muted-foreground">{unit}</span>
          )}
          {trend === "up" && (
            <TrendingUp className="w-4 h-4 text-chart-2 shrink-0" />
          )}
          {trend === "down" && (
            <TrendingDown className="w-4 h-4 text-chart-5 shrink-0" />
          )}
          {trend === "neutral" && (
            <Minus className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
        </div>
        {basis && (
          <p className="text-xs text-muted-foreground">Basis: {basis}</p>
        )}
      </div>

      {source && (
        <div className="flex justify-end">
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide",
              SOURCE_COLORS[source] ?? "bg-muted text-muted-foreground"
            )}
          >
            {SOURCE_LABELS[source]}
          </span>
        </div>
      )}
    </div>
  );
}
