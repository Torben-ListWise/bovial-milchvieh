import { DataTile } from "./DataTile";

interface KpiTileProps {
  label: string;
  value: number | string;
  unit: string;
  trend?: "up" | "down" | "neutral";
  "data-testid"?: string;
}

export function KpiTile({ label, value, unit, trend, "data-testid": dataTestId }: KpiTileProps) {
  return (
    <DataTile
      label={label}
      value={value}
      unit={unit}
      trend={trend}
      data-testid={dataTestId}
    />
  );
}
