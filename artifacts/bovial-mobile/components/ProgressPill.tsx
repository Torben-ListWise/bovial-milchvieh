import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type Props = {
  steps: string[];
  currentStep: string | null;
};

export function ProgressPill({ steps, currentStep }: Props) {
  const colors = useColors();

  const s = StyleSheet.create({
    container: { gap: 6 },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      alignSelf: "flex-start",
      borderWidth: 1,
    },
    active: {
      backgroundColor: colors.muted,
      borderColor: colors.border,
    },
    done: {
      backgroundColor: colors.muted + "80",
      borderColor: colors.border + "55",
    },
    text: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      flexShrink: 1,
    },
    activeText: { color: colors.mutedForeground },
    doneText: { color: colors.mutedForeground + "88" },
  });

  return (
    <View style={s.container}>
      {steps.map((step, i) => (
        <View key={i} style={[s.pill, s.done]}>
          <Ionicons name="checkmark-circle" size={14} color={colors.primary + "99"} />
          <Text style={[s.text, s.doneText]} numberOfLines={1}>{step}</Text>
        </View>
      ))}
      {currentStep && (
        <View style={[s.pill, s.active]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[s.text, s.activeText]} numberOfLines={1}>{currentStep}</Text>
        </View>
      )}
    </View>
  );
}
