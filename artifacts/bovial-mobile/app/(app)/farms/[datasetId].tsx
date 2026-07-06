import { useGetDataset, useListAnalyses, useCreateAnalysis } from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
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
import { NewAnalysisModal } from "@/components/NewAnalysisModal";
import * as Haptics from "expo-haptics";

export default function FarmDetailScreen() {
  const { datasetId } = useLocalSearchParams<{ datasetId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [showNewModal, setShowNewModal] = useState(false);

  const { data: dataset } = useGetDataset({ datasetId });
  const { data: analyses, isLoading, refetch, isFetching } = useListAnalyses({ datasetId });
  const createAnalysis = useCreateAnalysis();

  const handleNewAnalysis = async (question: string) => {
    setShowNewModal(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await createAnalysis.mutateAsync({
        datasetId,
        data: { question },
      });
      refetch();
      router.push(`/chat/${result.id}?new=1` as any);
    } catch (e) {
      console.error("Failed to create analysis", e);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + 8,
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    farmName: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    farmSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    sectionTitle: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 10,
    },
    list: { paddingHorizontal: 16, paddingBottom: 100 },
    fab: {
      position: "absolute",
      bottom: insets.bottom + 20,
      right: 20,
      backgroundColor: colors.primary,
      borderRadius: 28,
      paddingHorizontal: 20,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    fabText: {
      color: colors.primaryForeground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingTop: 60,
    },
    emptyText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 40,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.farmName}>{dataset?.name ?? "Betrieb"}</Text>
        {dataset && (
          <Text style={s.farmSub}>
            {dataset.fileCount ?? 0} Dateien · {analyses?.length ?? 0} Analysen
          </Text>
        )}
      </View>

      <Text style={s.sectionTitle}>Analysen</Text>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={analyses ?? []}
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
          renderItem={({ item }) => (
            <AnalysisCard
              analysis={item}
              onPress={() => router.push(`/chat/${item.id}` as any)}
            />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="chatbubble-ellipses-outline" size={56} color={colors.mutedForeground} />
              <Text style={s.emptyText}>
                Noch keine Analysen.{"\n"}Starte eine neue Analyse mit dem + Knopf.
              </Text>
            </View>
          }
        />
      )}

      <Pressable style={s.fab} onPress={() => setShowNewModal(true)}>
        <Ionicons name="add" size={20} color={colors.primaryForeground} />
        <Text style={s.fabText}>Neue Analyse</Text>
      </Pressable>

      <NewAnalysisModal
        visible={showNewModal}
        farmName={dataset?.name ?? "Betrieb"}
        onClose={() => setShowNewModal(false)}
        onSubmit={handleNewAnalysis}
        isLoading={createAnalysis.isPending}
      />
    </View>
  );
}
