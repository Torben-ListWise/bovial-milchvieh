import type { AnalysisMessage, Chart } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Rect, Line, Text as SvgText, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { DiaryChip } from "@/components/DiaryChip";

type Props = {
  message: AnalysisMessage;
  isStreaming?: boolean;
  onFeedback?: (messageId: string, rating: "up" | "down") => void;
};

export function MessageBubble({ message, isStreaming, onFeedback }: Props) {
  const colors = useColors();
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleFeedback = (rating: "up" | "down") => {
    if (feedback === rating) return;
    setFeedback(rating);
    onFeedback?.(message.id, rating);
  };

  const s = StyleSheet.create({
    wrapper: {
      marginBottom: 12,
      alignItems: isUser ? "flex-end" : "flex-start",
    },
    bubble: {
      maxWidth: "88%",
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: isUser ? colors.userBubble : colors.assistantBubble,
    },
    userBubble: {
      borderBottomRightRadius: 4,
    },
    assistantBubble: {
      borderBottomLeftRadius: 4,
    },
    content: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: isUser ? colors.userBubbleForeground : colors.assistantBubbleForeground,
      lineHeight: 22,
    },
    errorText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
      fontStyle: "italic",
    },
    chartContainer: {
      marginTop: 10,
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chartTitle: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      padding: 12,
      paddingBottom: 4,
    },
    kpiRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      padding: 12,
    },
    kpiCard: {
      backgroundColor: colors.secondary,
      borderRadius: 10,
      padding: 10,
      minWidth: 100,
      flex: 1,
    },
    kpiLabel: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    kpiValue: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    kpiUnit: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    tableRow: {
      flexDirection: "row",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableHeaderRow: {
      backgroundColor: colors.muted,
    },
    tableCell: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    tableHeaderCell: {
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      fontSize: 11,
      textTransform: "uppercase",
    },
    citationsRow: {
      marginTop: 10,
      gap: 4,
    },
    citation: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.muted,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    citationText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      flex: 1,
    },
    feedbackRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    feedbackBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    feedbackBtnActive: {
      backgroundColor: colors.primary + "22",
      borderColor: colors.primary,
    },
  });

  const renderCharts = (charts: Chart[]) => {
    return charts.map((chart) => (
      <View key={chart.id} style={s.chartContainer}>
        <Text style={s.chartTitle}>{chart.title}</Text>
        {chart.type === "kpi" ? renderKpiChart(chart) : null}
        {chart.type === "bar" ? renderBarChart(chart) : null}
        {chart.type === "table" ? renderTableChart(chart) : null}
        {(chart.type === "line" || chart.type === "area") ? renderLineChart(chart) : null}
      </View>
    ));
  };

  const renderKpiChart = (chart: Chart) => {
    const series = chart.series ?? [];
    if (!series.length && chart.data.length > 0) {
      const firstItem = chart.data[0] as Record<string, any>;
      const keys = Object.keys(firstItem).filter((k) => k !== chart.xKey);
      return (
        <View style={s.kpiRow}>
          {keys.map((key) => (
            <View key={key} style={s.kpiCard}>
              <Text style={s.kpiLabel}>{key}</Text>
              <Text style={s.kpiValue}>{String(firstItem[key])}</Text>
              {chart.unit ? <Text style={s.kpiUnit}>{chart.unit}</Text> : null}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View style={s.kpiRow}>
        {chart.data.slice(0, 6).map((row: any, i) => {
          const s2 = series[0];
          const valueKey = s2?.key ?? Object.keys(row).find((k) => k !== chart.xKey) ?? "value";
          const label = chart.xKey ? row[chart.xKey] : (s2?.label ?? valueKey);
          return (
            <View key={i} style={s.kpiCard}>
              <Text style={s.kpiLabel}>{label}</Text>
              <Text style={s.kpiValue}>{String(row[valueKey] ?? "—")}</Text>
              {chart.unit ? <Text style={s.kpiUnit}>{chart.unit}</Text> : null}
            </View>
          );
        })}
      </View>
    );
  };

  const renderBarChart = (chart: Chart) => {
    const WIDTH = 280;
    const HEIGHT = 160;
    const PAD = { top: 12, right: 12, bottom: 40, left: 36 };
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;

    const series = chart.series ?? [];
    const xKey = chart.xKey ?? "label";
    const valueKey = series[0]?.key ?? Object.keys(chart.data[0] ?? {}).find((k) => k !== xKey) ?? "value";
    const barColor = colors.primary;

    const data = chart.data.slice(0, 12) as Record<string, any>[];
    const values = data.map((d) => Number(d[valueKey]) || 0);
    const maxVal = Math.max(...values, 1);
    const barW = innerW / data.length - 4;

    return (
      <Svg width={WIDTH} height={HEIGHT} style={{ marginHorizontal: 4 }}>
        <G x={PAD.left} y={PAD.top}>
          {data.map((d, i) => {
            const h = Math.max(2, (values[i] / maxVal) * innerH);
            const x = i * (innerW / data.length) + (innerW / data.length - barW) / 2;
            const y = innerH - h;
            const label = String(d[xKey] ?? "").slice(0, 5);
            return (
              <G key={i}>
                <Rect x={x} y={y} width={barW} height={h} rx={3} fill={barColor} opacity={0.85} />
                <SvgText
                  x={x + barW / 2}
                  y={innerH + 14}
                  fontSize="9"
                  fill={colors.mutedForeground}
                  textAnchor="middle"
                >
                  {label}
                </SvgText>
              </G>
            );
          })}
          <Line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke={colors.border} strokeWidth={1} />
          <SvgText x={-4} y={4} fontSize="9" fill={colors.mutedForeground} textAnchor="end">
            {maxVal}
          </SvgText>
          <SvgText x={-4} y={innerH} fontSize="9" fill={colors.mutedForeground} textAnchor="end">
            0
          </SvgText>
        </G>
      </Svg>
    );
  };

  const renderLineChart = (chart: Chart) => {
    const WIDTH = 280;
    const HEIGHT = 140;
    const PAD = { top: 12, right: 12, bottom: 32, left: 36 };
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;

    const series = chart.series ?? [];
    const xKey = chart.xKey ?? "label";
    const valueKey = series[0]?.key ?? Object.keys(chart.data[0] ?? {}).find((k) => k !== xKey) ?? "value";
    const lineColor = colors.primary;

    const data = chart.data.slice(0, 20) as Record<string, any>[];
    const values = data.map((d) => Number(d[valueKey]) || 0);
    const maxVal = Math.max(...values, 1);
    const minVal = Math.min(...values, 0);
    const range = maxVal - minVal || 1;

    const pts = data.map((_, i) => ({
      x: PAD.left + (i / Math.max(data.length - 1, 1)) * innerW,
      y: PAD.top + innerH - ((values[i] - minVal) / range) * innerH,
    }));

    return (
      <Svg width={WIDTH} height={HEIGHT} style={{ marginHorizontal: 4 }}>
        {pts.length > 1 && (
          <G>
            <Line x1={PAD.left} y1={0} x2={PAD.left} y2={PAD.top + innerH} stroke={colors.border} strokeWidth={1} />
            <Line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke={colors.border} strokeWidth={1} />
          </G>
        )}
        {pts.length > 1 && (
          <G>
            {pts.slice(1).map((pt, i) => (
              <Line
                key={i}
                x1={pts[i].x}
                y1={pts[i].y}
                x2={pt.x}
                y2={pt.y}
                stroke={lineColor}
                strokeWidth={2}
                opacity={0.9}
              />
            ))}
          </G>
        )}
        {data.filter((_, i) => i % Math.ceil(data.length / 4) === 0).map((d, i) => {
          const realIdx = i * Math.ceil(data.length / 4);
          const p = pts[realIdx];
          if (!p) return null;
          return (
            <SvgText key={i} x={p.x} y={PAD.top + innerH + 14} fontSize="9" fill={colors.mutedForeground} textAnchor="middle">
              {String(d[xKey] ?? "").slice(0, 6)}
            </SvgText>
          );
        })}
        <SvgText x={PAD.left - 4} y={PAD.top + 4} fontSize="9" fill={colors.mutedForeground} textAnchor="end">
          {Math.round(maxVal)}
        </SvgText>
      </Svg>
    );
  };

  const renderTableChart = (chart: Chart) => {
    if (!chart.data.length) return null;
    const keys = Object.keys(chart.data[0] as Record<string, any>).slice(0, 4);
    const rows = chart.data.slice(0, 8) as Record<string, any>[];
    return (
      <View>
        <View style={[s.tableRow, s.tableHeaderRow]}>
          {keys.map((k) => (
            <Text key={k} style={[s.tableCell, s.tableHeaderCell]}>{k}</Text>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={s.tableRow}>
            {keys.map((k) => (
              <Text key={k} style={s.tableCell} numberOfLines={1}>{String(row[k] ?? "")}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={s.wrapper}>
      <View style={[s.bubble, isUser ? s.userBubble : s.assistantBubble]}>
        {message.error ? (
          <Text style={s.errorText}>{message.error}</Text>
        ) : (
          <>
            {message.content ? (
              <Text style={s.content}>
                {message.content}
                {isStreaming ? "\u258C" : ""}
              </Text>
            ) : null}
            {!isUser && message.charts && message.charts.length > 0 && (
              renderCharts(message.charts)
            )}
            {!isUser && message.loggedEvent && (
              <DiaryChip event={message.loggedEvent} />
            )}
            {!isUser && message.citations && message.citations.length > 0 && (
              <View style={s.citationsRow}>
                {message.citations.slice(0, 3).map((c, i) => (
                  <View key={i} style={s.citation}>
                    <Ionicons name="link-outline" size={12} color={colors.mutedForeground} />
                    <Text style={s.citationText} numberOfLines={1}>{c.label}</Text>
                  </View>
                ))}
              </View>
            )}
            {!isUser && !isStreaming && message.id !== "__streaming__" && onFeedback && (
              <View style={s.feedbackRow}>
                <Pressable
                  style={[s.feedbackBtn, feedback === "up" && s.feedbackBtnActive]}
                  onPress={() => handleFeedback("up")}
                >
                  <Ionicons
                    name={feedback === "up" ? "thumbs-up" : "thumbs-up-outline"}
                    size={14}
                    color={feedback === "up" ? colors.primary : colors.mutedForeground}
                  />
                </Pressable>
                <Pressable
                  style={[s.feedbackBtn, feedback === "down" && s.feedbackBtnActive]}
                  onPress={() => handleFeedback("down")}
                >
                  <Ionicons
                    name={feedback === "down" ? "thumbs-down" : "thumbs-down-outline"}
                    size={14}
                    color={feedback === "down" ? colors.destructive : colors.mutedForeground}
                  />
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
