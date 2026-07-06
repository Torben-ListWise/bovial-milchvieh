import type { Analysis } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  analysis: Analysis;
  onPress: () => void;
};

export function AnalysisCard({ analysis, onPress }: Props) {
  const colors = useColors();

  const formatDate = (str: string) => {
    try {
      const d = new Date(str);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      const days = Math.floor(diff / 86400000);
      if (days === 0) return "Heute";
      if (days === 1) return "Gestern";
      if (days < 7) return `Vor ${days} Tagen`;
      return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
    } catch {
      return str;
    }
  };

  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardPressed: { opacity: 0.75 },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    content: { flex: 1 },
    title: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      lineHeight: 22,
      marginBottom: 6,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    footerItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    footerText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    progressBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary + "20",
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    progressText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    pinned: {
      marginLeft: "auto" as any,
    },
  });

  return (
    <Pressable style={({ pressed }) => [s.card, pressed && s.cardPressed]} onPress={onPress}>
      <View style={s.row}>
        <View style={s.iconWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.mutedForeground} />
        </View>
        <View style={s.content}>
          <Text style={s.title} numberOfLines={2}>{analysis.title}</Text>
          <View style={s.footer}>
            {analysis.agentProgress ? (
              <View style={s.progressBadge}>
                <ActivityIndicator size="small" color={colors.primary} style={{ width: 12, height: 12 }} />
                <Text style={s.progressText}>Läuft…</Text>
              </View>
            ) : null}
            <View style={s.footerItem}>
              <Ionicons name="chatbubble-outline" size={12} color={colors.mutedForeground} />
              <Text style={s.footerText}>{analysis.messageCount ?? 0} Nachrichten</Text>
            </View>
            <View style={s.footerItem}>
              <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
              <Text style={s.footerText}>{formatDate(analysis.createdAt)}</Text>
            </View>
            {analysis.pinned && (
              <View style={s.pinned}>
                <Ionicons name="bookmark" size={14} color={colors.accent} />
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
