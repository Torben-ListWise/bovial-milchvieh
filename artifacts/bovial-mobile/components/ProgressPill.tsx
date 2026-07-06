import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  step: string;
};

export function ProgressPill({ step }: Props) {
  const colors = useColors();

  const s = StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignSelf: "flex-start",
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    text: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      flexShrink: 1,
    },
  });

  return (
    <View style={s.container}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={s.text} numberOfLines={1}>{step}</Text>
    </View>
  );
}
