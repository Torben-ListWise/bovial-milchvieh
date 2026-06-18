import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import type { Chart as ChartType } from '@workspace/api-client-react';

const COLORS = [
  'hsl(155 40% 35%)',
  'hsl(35 60% 50%)',
  'hsl(195 40% 45%)',
  'hsl(10 50% 55%)',
  'hsl(280 20% 50%)'
];

interface DynamicChartProps {
  chart: ChartType;
  height?: number;
  fillContainer?: boolean;
}

export function DynamicChart({ chart, height = 300, fillContainer = false }: DynamicChartProps) {
  const { type, xKey, series, data, unit } = chart;

  const renderTooltip = useMemo(() => {
    return ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
        return (
          <div className="bg-popover border border-border p-3 shadow-md rounded-md text-sm">
            <p className="font-medium text-foreground mb-2">{label}</p>
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-muted-foreground">{entry.name}:</span>
                <span className="font-semibold text-foreground">
                  {entry.value} {unit || ''}
                </span>
              </div>
            ))}
          </div>
        );
      }
      return null;
    };
  }, [unit]);

  if (!data || data.length === 0) {
    return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Keine Daten verfügbar</div>;
  }

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey || 'name'} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
            <Tooltip content={renderTooltip} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            {series?.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % COLORS.length]} strokeWidth={3} dot={{ r: 4, fill: COLORS[i % COLORS.length] }} activeDot={{ r: 6 }} />
            ))}
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey || 'name'} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
            <Tooltip content={renderTooltip} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            {series?.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        );
      case 'area':
        return (
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey || 'name'} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
            <Tooltip content={renderTooltip} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            {series?.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} stroke={COLORS[i % COLORS.length]} fillOpacity={0.2} strokeWidth={2} />
            ))}
          </AreaChart>
        );
      case 'pie':
        // Pie usually uses only the first series
        const pieKey = series?.[0]?.key || 'value';
        return (
          <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
            <Tooltip />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Pie
              data={data}
              dataKey={pieKey}
              nameKey={xKey || 'name'}
              cx="50%"
              cy="50%"
              outerRadius={height / 2 - 40}
              label={({ cx, cy, midAngle, innerRadius, outerRadius, index }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; value: number; index: number }) => {
                const RADIAN = Math.PI / 180;
                const radius = 25 + innerRadius + (outerRadius - innerRadius);
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text x={x} y={y} fill="hsl(var(--foreground))" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={12}>
                    {String(data[index]?.[xKey || 'name'] ?? '')}
                  </text>
                );
              }}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      case 'table':
        return (
          <div className="w-full h-full overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-secondary/50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-medium">{xKey || 'Kategorie'}</th>
                  {series?.map((s) => (
                    <th key={s.key} className="px-4 py-3 font-medium text-right">{s.label} {unit ? `(${unit})` : ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{String(row[xKey || 'name'])}</td>
                    {series?.map((s) => (
                      <td key={s.key} className="px-4 py-3 text-right">{row[s.key] !== undefined ? String(row[s.key]) : '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return <div className="flex h-full items-center justify-center text-muted-foreground">Diagrammtyp nicht unterstützt</div>;
    }
  };

  return (
    <div style={{ width: '100%', height: fillContainer ? '100%' : height }}>
      {type === 'table' ? (
        renderChart()
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      )}
    </div>
  );
}
