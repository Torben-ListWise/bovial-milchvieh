import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type DiaryEntry = {
  id: string;
  entryDate: string;
  category: string;
  description: string;
  reminderDays?: number | null;
  reminderDueAt?: string | null;
  remindedAt?: string | null;
  createdAt?: string | null;
};

type Section = {
  title: string;
  data: DiaryEntry[];
};

const CATEGORY_LABEL: Record<string, string> = {
  feed: "Fütterung",
  infrastructure: "Infrastruktur",
  health: "Tiergesundheit",
  management: "Betriebsführung",
  weather: "Wetter",
  other: "Sonstiges",
};

const CATEGORY_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  feed: "nutrition-outline",
  infrastructure: "construct-outline",
  health: "medkit-outline",
  management: "briefcase-outline",
  weather: "cloudy-outline",
  other: "ellipsis-horizontal-circle-outline",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function groupByDate(entries: DiaryEntry[]): Section[] {
  const map = new Map<string, DiaryEntry[]>();
  for (const e of entries) {
    const key = e.entryDate;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([date, data]) => ({
    title: formatDate(date),
    data,
  }));
}

export default function DiaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const fetchEntries = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(false);

    try {
      const data = await customFetch<DiaryEntry[]>("/api/diary?days=60&limit=100");
      setEntries(data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const sections = groupByDate(entries);

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
    sectionHeader: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
      backgroundColor: colors.background,
    },
    sectionHeaderText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    card: {
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.primary + "18",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    cardBody: {
      flex: 1,
    },
    categoryLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
      marginBottom: 3,
    },
    description: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      lineHeight: 20,
    },
    reminderPill: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary + "12",
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      alignSelf: "flex-start",
    },
    reminderText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      paddingHorizontal: 40,
    },
    emptyTitle: {
      fontSize: 17,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    emptyDesc: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    errorText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
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
    listContent: {
      paddingBottom: insets.bottom + 24,
    },
  });

  if (loading) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Tagebuch</Text>
          <Text style={s.headerSub}>Letzte 60 Tage</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Tagebuch</Text>
          <Text style={s.headerSub}>Letzte 60 Tage</Text>
        </View>
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
          <Text style={s.errorText}>Einträge konnten nicht geladen werden.</Text>
          <Pressable style={s.retryBtn} onPress={() => fetchEntries()}>
            <Text style={s.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Tagebuch</Text>
        <Text style={s.headerSub}>Letzte 60 Tage</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sections.length === 0 ? { flex: 1 } : s.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchEntries(true)}
            tintColor={colors.primary}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHeader}>
            <Text style={s.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const icon = CATEGORY_ICON[item.category] ?? "ellipsis-horizontal-circle-outline";
          const label = CATEGORY_LABEL[item.category] ?? item.category;
          return (
            <View style={s.card}>
              <View style={s.cardRow}>
                <View style={s.iconWrap}>
                  <Ionicons name={icon} size={18} color={colors.primary} />
                </View>
                <View style={s.cardBody}>
                  <Text style={s.categoryLabel}>{label}</Text>
                  <Text style={s.description}>{item.description}</Text>
                  {item.reminderDays != null && item.reminderDays > 0 && !item.remindedAt && (
                    <View style={s.reminderPill}>
                      <Ionicons name="alarm-outline" size={12} color={colors.primary} />
                      <Text style={s.reminderText}>
                        Erinnerung in {item.reminderDays} {item.reminderDays === 1 ? "Tag" : "Tagen"}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={[s.center, { paddingTop: 0 }]}>
            <Ionicons name="journal-outline" size={64} color={colors.primary + "66"} />
            <Text style={s.emptyTitle}>Noch keine Einträge</Text>
            <Text style={s.emptyDesc}>
              Tagebucheinträge erscheinen hier, sobald du sie über die Analyse-Funktion hinzufügst.
            </Text>
          </View>
        }
      />
    </View>
  );
}
