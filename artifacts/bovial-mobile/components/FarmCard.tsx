import type { Dataset } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  dataset: Dataset;
  onPress: () => void;
};

export function FarmCard({ dataset, onPress }: Props) {
  const colors = useColors();

  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    cardPressed: {
      opacity: 0.75,
    },
    iconContainer: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    content: {
      flex: 1,
    },
    name: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 4,
    },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    metaText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    arrow: {
      opacity: 0.4,
    },
  });

  return (
    <Pressable style={({ pressed }) => [s.card, pressed && s.cardPressed]} onPress={onPress}>
      <View style={s.iconContainer}>
        <Ionicons name="leaf" size={22} color={colors.primary} />
      </View>
      <View style={s.content}>
        <Text style={s.name}>{dataset.name}</Text>
        <View style={s.meta}>
          <View style={s.metaItem}>
            <Ionicons name="document-outline" size={13} color={colors.mutedForeground} />
            <Text style={s.metaText}>{(dataset as any).fileCount ?? 0} Dateien</Text>
          </View>
          <View style={s.metaItem}>
            <Ionicons name="chatbubble-outline" size={13} color={colors.mutedForeground} />
            <Text style={s.metaText}>{(dataset as any).analysisCount ?? 0} Analysen</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={s.arrow} />
    </Pressable>
  );
}
