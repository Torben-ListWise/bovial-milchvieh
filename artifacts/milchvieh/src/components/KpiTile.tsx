import { DataTile } from "./DataTile";

interface KpiTileProps {
  label: string;
  value: number | string;
  unit: string;
  trend?: "up" | "down" | "neutral";
}

export function KpiTile({ label, value, unit, trend }: KpiTileProps) {
  return (
    <DataTile
      label={label}
      value={value}
      unit={unit}
      trend={trend}
    />
  );
}
