import { useAuth, useUser } from "@clerk/expo";
import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export default function EinstellungenScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { user } = useUser();

  const handleSignOut = () => {
    Alert.alert(
      "Abmelden",
      "Möchtest du dich wirklich abmelden?",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Abmelden", style: "destructive", onPress: () => signOut() },
      ]
    );
  };

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
    content: {
      padding: 20,
    },
    userCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: "#fff",
    },
    userInfo: { flex: 1 },
    userName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 2,
    },
    userEmail: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    section: {
      marginBottom: 24,
    },
    sectionLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 10,
      paddingHorizontal: 4,
    },
    row: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    rowItem: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    rowLabelDestructive: {
      color: colors.destructive,
    },
    versionText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      marginTop: 8,
    },
  });

  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "B";
  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user?.emailAddresses?.[0]?.emailAddress ?? "Benutzer";
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Einstellungen</Text>
      </View>

      <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.userCard}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={s.userInfo}>
            <Text style={s.userName}>{displayName}</Text>
            {email ? <Text style={s.userEmail}>{email}</Text> : null}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>Konto</Text>
          <View style={s.row}>
            <Pressable style={s.rowItem} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
              <Text style={[s.rowLabel, s.rowLabelDestructive]}>Abmelden</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>App</Text>
          <View style={s.row}>
            <View style={s.rowItem}>
              <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
              <Text style={s.rowLabel}>Version</Text>
              <Text style={s.versionText}>1.0.0</Text>
            </View>
            <View style={[s.rowItem, s.rowBorder]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.mutedForeground} />
              <Text style={s.rowLabel}>Datenschutz</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
