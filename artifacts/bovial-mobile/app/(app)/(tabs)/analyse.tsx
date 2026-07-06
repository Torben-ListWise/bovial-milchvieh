import { useListDatasets, useListAnalyses } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnalysisCard } from "@/components/AnalysisCard";

function DatasetAnalyses({ datasetId }: { datasetId: string }) {
  const { data } = useListAnalyses({ datasetId });
  return data ?? [];
}

export default function AnalyseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: datasets, isLoading, isError, refetch, isFetching } = useListDatasets();

  const allAnalyses = React.useMemo(() => {
    return [];
  }, []);

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
    farmSection: {
      marginBottom: 24,
    },
    farmLabel: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 10,
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
              onPressAnalysis={(analysisId) =>
                router.push(`/chat/${analysisId}` as any)
              }
            />
          )}
        />
      )}
    </View>
  );
}

function DatasetAnalysisSection({
  datasetId,
  datasetName,
  onPressAnalysis,
}: {
  datasetId: string;
  datasetName: string;
  onPressAnalysis: (id: string) => void;
}) {
  const colors = useColors();
  const { data: analyses } = useListAnalyses({ datasetId });

  const s = StyleSheet.create({
    section: { marginBottom: 20 },
    farmLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 8,
    },
    empty: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      fontStyle: "italic",
    },
  });

  if (!analyses || analyses.length === 0) return null;

  return (
    <View style={s.section}>
      <Text style={s.farmLabel}>{datasetName}</Text>
      {analyses.slice(0, 5).map((a) => (
        <AnalysisCard key={a.id} analysis={a} onPress={() => onPressAnalysis(a.id)} />
      ))}
    </View>
  );
}
