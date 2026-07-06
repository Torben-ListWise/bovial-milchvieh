import { useListDatasets, useListAnalyses } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
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
import { AnalysisCard } from "@/components/AnalysisCard";

const LAST_ANALYSIS_KEY = (datasetId: string) => `lastAnalysisId:${datasetId}`;

function DatasetAnalysisSection({
  datasetId,
  datasetName,
  onPressAnalysis,
  onPressDataset,
}: {
  datasetId: string;
  datasetName: string;
  onPressAnalysis: (id: string) => void;
  onPressDataset: (id: string) => void;
}) {
  const colors = useColors();
  const { data: analyses } = useListAnalyses({ datasetId });
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LAST_ANALYSIS_KEY(datasetId)).then((v) => setLastId(v)).catch(() => {});
  }, [datasetId]);

  const s = StyleSheet.create({
    section: { marginBottom: 20 },
    farmHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    farmLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    openBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary + "15",
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    openBtnText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    lastBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.accent + "20",
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginBottom: 4,
    },
    lastBadgeText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.accent,
    },
  });

  if (!analyses || analyses.length === 0) return null;

  return (
    <View style={s.section}>
      <View style={s.farmHeader}>
        <Text style={s.farmLabel}>{datasetName}</Text>
        <Pressable style={s.openBtn} onPress={() => onPressDataset(datasetId)}>
          <Ionicons name="chatbubble-outline" size={12} color={colors.primary} />
          <Text style={s.openBtnText}>Öffnen</Text>
        </Pressable>
      </View>

      {analyses.slice(0, 5).map((a) => (
        <View key={a.id}>
          {a.id === lastId && (
            <View style={s.lastBadge}>
              <Ionicons name="time-outline" size={11} color={colors.accent} />
              <Text style={s.lastBadgeText}>Zuletzt geöffnet</Text>
            </View>
          )}
          <AnalysisCard analysis={a} onPress={() => onPressAnalysis(a.id)} />
        </View>
      ))}
    </View>
  );
}

export default function AnalyseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: datasets, isLoading, isError, refetch, isFetching } = useListDatasets();

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
    list: {
      padding: 16,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 32,
    },
    centerText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });

  if (isLoading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Analysen</Text>
        <Text style={s.headerSub}>Alle Analysen über Betriebe hinweg</Text>
      </View>

      {(!datasets || datasets.length === 0) ? (
        <View style={s.center}>
          <Ionicons name="chatbubbles-outline" size={56} color={colors.mutedForeground} />
          <Text style={s.centerText}>
            Noch keine Analysen vorhanden.{"\n"}Wähle einen Betrieb und starte eine Analyse.
          </Text>
        </View>
      ) : (
        <FlatList
          data={datasets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item: dataset }) => (
            <DatasetAnalysisSection
              datasetId={dataset.id}
              datasetName={dataset.name}
              onPressAnalysis={(analysisId) => router.push(`/chat/${analysisId}` as any)}
              onPressDataset={(datasetId) => router.push(`/farms/${datasetId}` as any)}
            />
          )}
        />
      )}
    </View>
  );
}
