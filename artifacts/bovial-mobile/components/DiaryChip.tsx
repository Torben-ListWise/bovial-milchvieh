import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type LoggedEvent = {
  id: string;
  description: string;
  entryDate: string;
  category: string;
  reminderDueAt?: string | null;
};

type Props = {
  event: LoggedEvent;
};

export function DiaryChip({ event }: Props) {
  const colors = useColors();

  const s = StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      backgroundColor: colors.accent + "22",
      borderRadius: 10,
      padding: 10,
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.accent + "55",
    },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.accent + "33",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    content: { flex: 1 },
    label: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.accent,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 3,
    },
    description: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      lineHeight: 18,
    },
    reminderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 6,
    },
    reminderText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.accent,
    },
  });

  const formatDate = (str?: string | null) => {
    if (!str) return "";
    try {
      return new Date(str).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return str;
    }
  };

  return (
    <View style={s.chip}>
      <View style={s.iconWrap}>
        <Ionicons name="journal" size={14} color={colors.accent} />
      </View>
      <View style={s.content}>
        <Text style={s.label}>Im Tagebuch gespeichert</Text>
        <Text style={s.description}>{event.description}</Text>
        {event.reminderDueAt && (
          <View style={s.reminderRow}>
            <Ionicons name="alarm-outline" size={12} color={colors.accent} />
            <Text style={s.reminderText}>Erinnerung: {formatDate(event.reminderDueAt)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
