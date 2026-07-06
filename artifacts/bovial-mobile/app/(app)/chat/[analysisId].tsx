import { useAuth } from "@clerk/expo";
import {
  useGetAnalysis,
  useAskQuestion,
  customFetch,
  getAuthToken,
} from "@workspace/api-client-react";
import type { Chart } from "@workspace/api-client-react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import EventSource from "react-native-sse";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { MessageBubble } from "@/components/MessageBubble";
import { ProgressPill } from "@/components/ProgressPill";

type DiaryEntry = {
  id: string;
  entryDate: string;
  category: string;
  description: string;
  reminderDays?: number | null;
  reminderDueAt?: string | null;
};

type StreamingState = {
  text: string;
  completedSteps: string[];
  currentStep: string | null;
  chart: Chart | null;
};

const DIARY_CATEGORIES = [
  { key: "health", label: "Tiergesundheit" },
  { key: "feed", label: "Fütterung" },
  { key: "management", label: "Betriebsführung" },
  { key: "infrastructure", label: "Infrastruktur" },
  { key: "weather", label: "Wetter" },
  { key: "other", label: "Sonstiges" },
];

const LAST_ANALYSIS_KEY = (datasetId: string) => `lastAnalysisId:${datasetId}`;

export default function ChatScreen() {
  const { analysisId, new: isNew } = useLocalSearchParams<{
    analysisId: string;
    new?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { getToken } = useAuth();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntry[]>([]);

  const [diaryDate, setDiaryDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [diaryCategory, setDiaryCategory] = useState("other");
  const [diaryDesc, setDiaryDesc] = useState("");
  const [diaryReminderDays, setDiaryReminderDays] = useState("");
  const [diarySaving, setDiarySaving] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const esRef = useRef<EventSource | null>(null);
  const streamingStarted = useRef(false);
  const diarySheetRef = useRef<BottomSheetModal>(null);

  const { data: analysis, refetch } = useGetAnalysis({ analysisId });
  const askQuestion = useAskQuestion();

  useEffect(() => {
    if (analysis?.title) {
      navigation.setOptions({ title: analysis.title });
    }
    if (analysis?.datasetId) {
      AsyncStorage.setItem(
        LAST_ANALYSIS_KEY(analysis.datasetId),
        analysisId
      ).catch(() => {});
    }
  }, [analysis?.title, analysis?.datasetId]);

  useEffect(() => {
    fetchDiaryPreview();
  }, []);

  useEffect(() => {
    if (isNew === "1" && !streamingStarted.current) {
      streamingStarted.current = true;
      connectSSE(false);
    }
    return () => {
      esRef.current?.close();
    };
  }, [analysisId]);

  const fetchDiaryPreview = useCallback(async () => {
    try {
      const entries = await customFetch<DiaryEntry[]>("/api/diary?limit=2");
      setDiaryEntries(entries ?? []);
    } catch {}
  }, []);

  const connectSSE = useCallback(
    async (postQuestion: string | false) => {
      esRef.current?.close();
      esRef.current = null;

      const token = await getToken();
      if (!token) return;

      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) return;

      setStreaming({
        text: "",
        completedSteps: [],
        currentStep: "Verbinde…",
        chart: null,
      });

      const url = `https://${domain}/api/stream?analysisId=${encodeURIComponent(analysisId)}&token=${encodeURIComponent(token)}`;

      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected" as any, async () => {
        if (postQuestion) {
          try {
            await askQuestion.mutateAsync({
              analysisId,
              data: { question: postQuestion },
            });
          } catch {
            es.close();
            setStreaming(null);
          }
        } else {
          setStreaming((prev) =>
            prev ? { ...prev, currentStep: null } : prev
          );
        }
      });

      es.addEventListener("open" as any, async () => {
        // fallback: if "connected" event doesn't fire, POST on open
      });

      es.addEventListener("delta" as any, (e: any) => {
        const payload = JSON.parse(e.data ?? "{}");
        setStreaming((prev) =>
          prev
            ? { ...prev, text: prev.text + (payload.text ?? ""), currentStep: null }
            : prev
        );
      });

      es.addEventListener("turn_reset" as any, () => {
        setStreaming((prev) =>
          prev ? { ...prev, text: "", completedSteps: [], currentStep: null } : prev
        );
      });

      es.addEventListener("progress" as any, (e: any) => {
        const payload = JSON.parse(e.data ?? "{}");
        const step: string | null = payload.step ?? null;
        if (!step) return;
        setStreaming((prev) => {
          if (!prev) return prev;
          const completed = prev.currentStep
            ? [...prev.completedSteps, prev.currentStep]
            : prev.completedSteps;
          return { ...prev, completedSteps: completed, currentStep: step };
        });
      });

      es.addEventListener("chart" as any, (e: any) => {
        const payload = JSON.parse(e.data ?? "{}");
        setStreaming((prev) =>
          prev ? { ...prev, chart: payload.chart ?? null } : prev
        );
      });

      es.addEventListener("done" as any, async () => {
        es.close();
        esRef.current = null;
        await refetch();
        await fetchDiaryPreview();
        setStreaming(null);
      });

      es.addEventListener("agenterror" as any, (e: any) => {
        let message = "Fehler bei der Analyse";
        try {
          const payload = JSON.parse(e?.data ?? "{}");
          message = payload.message ?? message;
        } catch {}
        Alert.alert("Fehler", message);
        es.close();
        esRef.current = null;
        refetch();
        setStreaming(null);
      });
    },
    [analysisId, getToken, askQuestion, refetch, fetchDiaryPreview]
  );

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming || askQuestion.isPending) return;
    setInput("");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    connectSSE(question);
  }, [input, streaming, askQuestion, connectSSE]);

  const handleDiarySave = async () => {
    const desc = diaryDesc.trim();
    if (!desc) return;
    setDiarySaving(true);
    try {
      const reminderDays =
        diaryReminderDays.trim() !== "" ? parseInt(diaryReminderDays.trim(), 10) : null;
      await customFetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate: diaryDate,
          category: diaryCategory,
          description: desc,
          reminderDays: reminderDays && !isNaN(reminderDays) ? reminderDays : null,
        }),
      });
      diarySheetRef.current?.dismiss();
      setDiaryDesc("");
      setDiaryCategory("other");
      setDiaryReminderDays("");
      setDiaryDate(new Date().toISOString().slice(0, 10));
      fetchDiaryPreview();
    } catch {
      Alert.alert("Fehler", "Ereignis konnte nicht gespeichert werden.");
    } finally {
      setDiarySaving(false);
    }
  };

  const messages = analysis?.messages ?? [];
  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const showDiaryCta =
    !streaming && lastAssistantMsg && lastAssistantMsg.loggedEvent != null;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    list: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    inputArea: { backgroundColor: colors.background },
    diaryCtaWrap: {
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    diaryCta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.accent + "22",
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.accent + "55",
    },
    diaryCtaText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.accent,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 8,
    },
    inputWrap: {
      flex: 1,
      backgroundColor: colors.secondary,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
    },
    input: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { opacity: 0.4 },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    streamingWrap: { marginBottom: 8, gap: 4 },
    diaryPreviewSection: {
      marginHorizontal: 16,
      marginBottom: 16,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    diaryPreviewHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    diaryPreviewTitle: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    diaryPreviewAddBtn: {
      marginLeft: "auto" as any,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.accent + "20",
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    diaryPreviewAddText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.accent,
    },
    diaryPreviewEmpty: {
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    diaryPreviewEmptyText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    diaryPreviewRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    diaryPreviewDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
      marginTop: 4,
    },
    diaryPreviewDesc: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      lineHeight: 18,
    },
    diaryPreviewDate: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    sheetContent: {
      padding: 20,
      paddingBottom: insets.bottom + 24,
    },
    sheetTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    sheetSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 20,
    },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 6,
    },
    fieldInput: {
      backgroundColor: colors.secondary,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 14,
    },
    descInput: { minHeight: 72 },
    catRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 14,
    },
    catChip: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.secondary,
    },
    catChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    catChipText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    catChipTextActive: { color: "#fff" },
    saveBtn: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: "#fff",
    },
  });

  if (!analysis) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const canSend = input.trim().length > 0 && !streaming && !askQuestion.isPending;

  const formatDate = (str: string) => {
    try {
      return new Date(str).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "short",
      });
    } catch {
      return str;
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior="padding" keyboardVerticalOffset={0}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        inverted
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            onFeedback={async (messageId, rating) => {
              try {
                await customFetch(`/api/messages/${messageId}/feedback`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rating }),
                });
              } catch {}
            }}
          />
        )}
        ListHeaderComponent={
          streaming ? (
            <View style={s.streamingWrap}>
              <ProgressPill
                steps={streaming.completedSteps}
                currentStep={streaming.currentStep}
              />
              {(streaming.text || streaming.chart) && (
                <MessageBubble
                  message={{
                    id: "__streaming__",
                    analysisId,
                    role: "assistant",
                    content: streaming.text || null,
                    charts: streaming.chart ? [streaming.chart] : [],
                    citations: [],
                    followUpQuestions: [],
                    loggedEvent: null,
                    createdAt: new Date().toISOString(),
                  }}
                  isStreaming
                />
              )}
            </View>
          ) : diaryEntries.length > 0 ? (
            <View style={s.diaryPreviewSection}>
              <View style={s.diaryPreviewHeader}>
                <Ionicons name="journal-outline" size={14} color={colors.accent} />
                <Text style={s.diaryPreviewTitle}>Letzte Ereignisse</Text>
                <Pressable
                  style={s.diaryPreviewAddBtn}
                  onPress={() => diarySheetRef.current?.present()}
                >
                  <Ionicons name="add" size={14} color={colors.accent} />
                  <Text style={s.diaryPreviewAddText}>Neu</Text>
                </Pressable>
              </View>
              {diaryEntries.map((entry) => (
                <View key={entry.id} style={s.diaryPreviewRow}>
                  <View style={s.diaryPreviewDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.diaryPreviewDesc} numberOfLines={2}>
                      {entry.description}
                    </Text>
                    <Text style={s.diaryPreviewDate}>{formatDate(entry.entryDate)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null
        }
      />

      <View style={s.inputArea}>
        {showDiaryCta && (
          <View style={s.diaryCtaWrap}>
            <Pressable
              style={s.diaryCta}
              onPress={() => diarySheetRef.current?.present()}
            >
              <Ionicons name="journal" size={16} color={colors.accent} />
              <Text style={s.diaryCtaText}>📅 Ereignis wurde ins Tagebuch eingetragen</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} style={{ marginLeft: "auto" as any }} />
            </Pressable>
          </View>
        )}

        <View style={s.inputRow}>
          <View style={s.inputWrap}>
            <TextInput
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Frage stellen…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              returnKeyType="send"
              onSubmitEditing={canSend ? handleSend : undefined}
              editable={!streaming}
            />
          </View>
          <Pressable
            style={[s.sendBtn, !canSend && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            {askQuestion.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      <BottomSheetModal
        ref={diarySheetRef}
        snapPoints={["60%", "85%"]}
        backgroundStyle={{ backgroundColor: colors.card }}
        handleIndicatorStyle={{ backgroundColor: colors.border }}
        enableDynamicSizing={false}
      >
        <BottomSheetView>
          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={s.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.sheetTitle}>Ereignis eintragen</Text>
            <Text style={s.sheetSub}>Im Betriebstagebuch speichern</Text>

            <Text style={s.label}>Datum (JJJJ-MM-TT)</Text>
            <BottomSheetTextInput
              style={s.fieldInput}
              value={diaryDate}
              onChangeText={setDiaryDate}
              placeholder="JJJJ-MM-TT"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
            />

            <Text style={s.label}>Beschreibung</Text>
            <BottomSheetTextInput
              style={[s.fieldInput, s.descInput]}
              value={diaryDesc}
              onChangeText={setDiaryDesc}
              placeholder="Was ist passiert?"
              placeholderTextColor={colors.mutedForeground}
              multiline
            />

            <Text style={s.label}>Kategorie</Text>
            <View style={s.catRow}>
              {DIARY_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.key}
                  style={[s.catChip, diaryCategory === cat.key && s.catChipActive]}
                  onPress={() => setDiaryCategory(cat.key)}
                >
                  <Text
                    style={[
                      s.catChipText,
                      diaryCategory === cat.key && s.catChipTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Erinnerung (Tage nach Ereignis, leer = keine)</Text>
            <BottomSheetTextInput
              style={s.fieldInput}
              value={diaryReminderDays}
              onChangeText={setDiaryReminderDays}
              placeholder="z. B. 7"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
            />

            <Pressable
              style={[s.saveBtn, (!diaryDesc.trim() || diarySaving) && s.saveBtnDisabled]}
              onPress={handleDiarySave}
              disabled={!diaryDesc.trim() || diarySaving}
            >
              {diarySaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.saveBtnText}>Im Tagebuch speichern</Text>
              )}
            </Pressable>
          </ScrollView>
        </BottomSheetView>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}
