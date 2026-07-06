import { useAuth } from "@clerk/expo";
import { useGetAnalysis, useAskQuestion, customFetch } from "@workspace/api-client-react";
import type { Chart } from "@workspace/api-client-react";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import EventSource from "react-native-sse";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BottomSheetModal, BottomSheetView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { MessageBubble } from "@/components/MessageBubble";
import { ProgressPill } from "@/components/ProgressPill";

type StreamingState = {
  text: string;
  step: string | null;
  chart: Chart | null;
  done: boolean;
};

const DIARY_CATEGORIES = [
  { key: "gesundheit", label: "Gesundheit" },
  { key: "fortpflanzung", label: "Fortpflanzung" },
  { key: "fuetterung", label: "Fütterung" },
  { key: "technik", label: "Technik" },
  { key: "sonstiges", label: "Sonstiges" },
];

const LAST_ANALYSIS_KEY = (datasetId: string) => `lastAnalysisId:${datasetId}`;

export default function ChatScreen() {
  const { analysisId, new: isNew } = useLocalSearchParams<{ analysisId: string; new?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { getToken } = useAuth();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [diaryDesc, setDiaryDesc] = useState("");
  const [diaryCategory, setDiaryCategory] = useState("sonstiges");
  const [diaryDate] = useState(() => new Date().toISOString().slice(0, 10));
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
      AsyncStorage.setItem(LAST_ANALYSIS_KEY(analysis.datasetId), analysisId).catch(() => {});
    }
  }, [analysis?.title, analysis?.datasetId]);

  useEffect(() => {
    if (isNew === "1" && !streamingStarted.current) {
      streamingStarted.current = true;
      connectSSE(false);
    }
    return () => {
      esRef.current?.close();
    };
  }, [analysisId]);

  const connectSSE = useCallback(
    async (postQuestion?: string | false) => {
      esRef.current?.close();
      esRef.current = null;

      const token = await getToken();
      if (!token) return;

      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) return;

      setStreaming({ text: "", step: "Verbinde…", chart: null, done: false });

      const es = new EventSource(
        `https://${domain}/api/analyses/${analysisId}/stream`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      esRef.current = es;

      es.addEventListener("open", async () => {
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
        }
      });

      es.addEventListener("delta" as any, (e: any) => {
        const payload = JSON.parse(e.data ?? "{}");
        setStreaming((prev) =>
          prev ? { ...prev, text: prev.text + (payload.text ?? ""), step: null } : prev
        );
      });

      es.addEventListener("progress" as any, (e: any) => {
        const payload = JSON.parse(e.data ?? "{}");
        setStreaming((prev) =>
          prev ? { ...prev, step: payload.step ?? null } : prev
        );
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
        setStreaming(null);
      });

      es.addEventListener("error" as any, (e: any) => {
        let message = "Fehler bei der Analyse";
        try {
          const payload = JSON.parse(e?.data ?? "{}");
          message = payload.message ?? message;
        } catch {}
        setStreaming((prev) =>
          prev ? { ...prev, text: message, done: true, step: null } : prev
        );
        es.close();
        esRef.current = null;
        refetch();
      });
    },
    [analysisId, getToken, askQuestion, refetch]
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
      await customFetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate: diaryDate,
          category: diaryCategory,
          description: desc,
        }),
      });
      diarySheetRef.current?.dismiss();
      setDiaryDesc("");
      setDiaryCategory("sonstiges");
      Alert.alert("Gespeichert", "Ereignis wurde im Tagebuch gespeichert.");
    } catch {
      Alert.alert("Fehler", "Ereignis konnte nicht gespeichert werden.");
    } finally {
      setDiarySaving(false);
    }
  };

  const messages = analysis?.messages ?? [];
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const showDiaryCta = !streaming && lastAssistantMsg && !lastAssistantMsg.loggedEvent;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    list: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginRight: 8,
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    inputArea: {
      backgroundColor: colors.background,
    },
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
    streamingBubble: { marginBottom: 8 },
    sheetContent: {
      flex: 1,
      padding: 24,
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
    textInput: {
      backgroundColor: colors.secondary,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
      minHeight: 80,
    },
    catRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 20,
    },
    catChip: {
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
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
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: "#fff",
    },
  });

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={s.headerRight}>
          <Pressable
            style={s.headerBtn}
            onPress={() => router.push(`/analyses?datasetId=${analysis?.datasetId}` as any)}
          >
            <Ionicons name="list-outline" size={18} color={colors.foreground} />
          </Pressable>
        </View>
      ),
    });
  }, [analysis?.datasetId]);

  if (!analysis) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const canSend = input.trim().length > 0 && !streaming && !askQuestion.isPending;

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
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
            <View style={s.streamingBubble}>
              {streaming.step && <ProgressPill step={streaming.step} />}
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
              <Ionicons name="journal-outline" size={16} color={colors.accent} />
              <Text style={s.diaryCtaText}>📅 Ereignis eintragen?</Text>
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
        snapPoints={["55%", "80%"]}
        backgroundStyle={{ backgroundColor: colors.card }}
        handleIndicatorStyle={{ backgroundColor: colors.border }}
      >
        <BottomSheetView style={s.sheetContent}>
          <Text style={s.sheetTitle}>Ereignis eintragen</Text>
          <Text style={s.sheetSub}>Im Tagebuch speichern</Text>

          <Text style={s.label}>Beschreibung</Text>
          <BottomSheetTextInput
            style={s.textInput}
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
                  style={[s.catChipText, diaryCategory === cat.key && s.catChipTextActive]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

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
        </BottomSheetView>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}
