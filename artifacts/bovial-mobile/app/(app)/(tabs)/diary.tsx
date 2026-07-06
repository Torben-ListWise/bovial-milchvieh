import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { customFetch } from "@workspace/api-client-react";

type DiaryEntry = {
  id: string;
  description: string;
  entryDate: string;
  category: string;
  reminderDueAt?: string | null;
  datasetName?: string;
};

export default function DiaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await customFetch("/api/diary?days=60");
      if (!res.ok) throw new Error("Fehler beim Laden");
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? "Unbekannter Fehler");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
    list: { padding: 16 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    categoryBadge: {
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    categoryText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      textTransform: "uppercase",
    },
    dateText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    description: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      lineHeight: 22,
    },
    reminderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 10,
      backgroundColor: colors.accent + "22",
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    reminderText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.accent,
    },
    emptyText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    errorText: {
      fontSize: 14,
      color: colors.destructive,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
    },
    retryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    retryText: {
      color: colors.primaryForeground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
    },
  });

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Tagebuch</Text>
      </View>

      {error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => load()}>
            <Text style={s.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <View style={s.categoryBadge}>
                  <Text style={s.categoryText}>{item.category}</Text>
                </View>
                <Text style={s.dateText}>{formatDate(item.entryDate)}</Text>
              </View>
              <Text style={s.description}>{item.description}</Text>
              {item.reminderDueAt && (
                <View style={s.reminderRow}>
                  <Ionicons name="alarm-outline" size={14} color={colors.accent} />
                  <Text style={s.reminderText}>
                    Erinnerung: {formatDate(item.reminderDueAt)}
                  </Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={[s.center, { paddingTop: 60 }]}>
              <Ionicons name="journal-outline" size={56} color={colors.mutedForeground} />
              <Text style={s.emptyText}>
                Noch keine Tagebucheinträge.{"\n"}Chat mit dem Assistenten, um Ereignisse zu protokollieren.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
