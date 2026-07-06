import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export default function BerichteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: insets.top + 16,
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 4,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      paddingHorizontal: 40,
    },
    badge: {
      backgroundColor: colors.primary + "20",
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    badgeText: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    title: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    desc: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Berichte</Text>
        <Text style={s.headerSub}>Automatisch erstellte Betriebsberichte</Text>
      </View>
      <View style={s.center}>
        <Ionicons name="bar-chart-outline" size={64} color={colors.primary + "66"} />
        <View style={s.badge}>
          <Text style={s.badgeText}>Demnächst verfügbar</Text>
        </View>
        <Text style={s.title}>Betriebsberichte</Text>
        <Text style={s.desc}>
          Automatische PDF-Berichte zu Leistungskennzahlen, Trends und
          Handlungsempfehlungen werden hier erscheinen.
        </Text>
      </View>
    </View>
  );
}
