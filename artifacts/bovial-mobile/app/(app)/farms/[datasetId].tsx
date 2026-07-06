import { useListAnalyses, useCreateAnalysis } from "@workspace/api-client-react";
import { Redirect, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

const LAST_ANALYSIS_KEY = (datasetId: string) => `lastAnalysisId:${datasetId}`;

export default function FarmRouterScreen() {
  const { datasetId } = useLocalSearchParams<{ datasetId: string }>();
  const colors = useColors();

  const { data: analyses, isLoading } = useListAnalyses({ datasetId });
  const createAnalysis = useCreateAnalysis();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading || !datasetId) return;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(LAST_ANALYSIS_KEY(datasetId));
        if (stored && analyses?.some((a) => a.id === stored)) {
          setTargetId(stored);
          return;
        }

        if (analyses && analyses.length > 0) {
          const latest = [...analyses].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          await AsyncStorage.setItem(LAST_ANALYSIS_KEY(datasetId), latest.id);
          setTargetId(latest.id);
          return;
        }

        const created = await createAnalysis.mutateAsync({
          datasetId,
          data: { question: "Wie ist der aktuelle Stand meines Betriebs?" },
        });
        await AsyncStorage.setItem(LAST_ANALYSIS_KEY(datasetId), created.id);
        setIsNew(true);
        setTargetId(created.id);
      } catch (e) {
        console.error("Farm router error", e);
        setError("Betrieb konnte nicht geöffnet werden.");
      }
    })();
  }, [isLoading, datasetId, analyses]);

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    text: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });

  if (error) {
    return (
      <View style={s.container}>
        <Text style={[s.text, { color: colors.destructive }]}>{error}</Text>
      </View>
    );
  }

  if (targetId) {
    if (isNew) {
      return <Redirect href={`/chat/${targetId}?new=1` as any} />;
    }
    return <Redirect href={`/chat/${targetId}` as any} />;
  }

  return (
    <View style={s.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={s.text}>Betrieb wird geöffnet…</Text>
    </View>
  );
}
