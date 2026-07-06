import { useAuth } from "@clerk/expo";
import { useGetAnalysis, useAskQuestion } from "@workspace/api-client-react";
import type { Chart } from "@workspace/api-client-react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MessageBubble } from "@/components/MessageBubble";
import { ProgressPill } from "@/components/ProgressPill";
import { customFetch } from "@workspace/api-client-react";

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

export default function ChatScreen() {
  const { analysisId, new: isNew } = useLocalSearchParams<{ analysisId: string; new?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { getToken } = useAuth();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [diaryModal, setDiaryModal] = useState(false);
  const [diaryDesc, setDiaryDesc] = useState("");
  const [diaryCategory, setDiaryCategory] = useState("sonstiges");
  const [diaryDate, setDiaryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [diarySaving, setDiarySaving] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const abortRef = useRef<boolean>(false);
  const streamingStarted = useRef<boolean>(false);

  const { data: analysis, refetch } = useGetAnalysis({ analysisId });
  const askQuestion = useAskQuestion();

  useEffect(() => {
    if (analysis?.title) {
      navigation.setOptions({ title: analysis.title });
    }
  }, [analysis?.title]);

  useEffect(() => {
    if (isNew === "1" && !streamingStarted.current) {
      streamingStarted.current = true;
      startStreaming();
    }
  }, [analysisId]);

  const startStreaming = useCallback(async () => {
    abortRef.current = false;
    const token = await getToken();
    if (!token) return;

    setStreaming({ text: "", step: "Verbinde…", chart: null, done: false });

    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;

    try {
      const response = await expoFetch(
        `https://${domain}/api/analyses/${analysisId}/stream`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
        }
      );

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!abortRef.current) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          let eventName = "message";
          let dataLine = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLine = line.slice(6);
          }

          if (!dataLine) continue;

          try {
            const payload = JSON.parse(dataLine);

            setStreaming((prev) => {
              if (!prev) return prev;
              if (eventName === "delta") {
                return { ...prev, text: prev.text + (payload.text ?? ""), step: null };
              }
              if (eventName === "progress") {
                return { ...prev, step: payload.step ?? null };
              }
              if (eventName === "chart") {
                return { ...prev, chart: payload.chart ?? null };
              }
              if (eventName === "done") {
                return { ...prev, done: true, step: null };
              }
              if (eventName === "agenterror") {
                return { ...prev, text: payload.message ?? "Fehler bei der Analyse", done: true, step: null };
              }
              return prev;
            });

            if (eventName === "done" || eventName === "agenterror") {
              reader.cancel();
              break;
            }
          } catch {
          }
        }
      }
    } catch (e) {
      console.error("SSE error", e);
      setStreaming((prev) => prev ? { ...prev, done: true, step: null } : null);
    } finally {
      await refetch();
      setStreaming(null);
    }
  }, [analysisId, getToken, refetch]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming || askQuestion.isPending) return;

    setInput("");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await askQuestion.mutateAsync({
        analysisId,
        data: { question },
      });
    } catch {
      return;
    }

    startStreaming();
  }, [input, streaming, askQuestion, analysisId, startStreaming]);

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
      setDiaryModal(false);
      setDiaryDesc("");
      setDiaryCategory("sonstiges");
      setDiaryDate(new Date().toISOString().slice(0, 10));
      Alert.alert("Gespeichert", "Ereignis wurde im Tagebuch gespeichert.");
    } catch {
      Alert.alert("Fehler", "Ereignis konnte nicht gespeichert werden.");
    } finally {
      setDiarySaving(false);
    }
  };

  const messages = analysis?.messages ?? [];

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    list: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
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
    diaryCtaWrap: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      backgroundColor: colors.background,
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
    sendBtnDisabled: {
      opacity: 0.4,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    streamingBubble: {
      marginBottom: 8,
    },
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: insets.bottom + 24,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 20,
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
      marginBottom: 16,
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
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    catChipText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    catChipTextActive: {
      color: "#fff",
    },
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

  if (!analysis) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const canSend = input.trim().length > 0 && !streaming && !askQuestion.isPending;
  const showDiaryCta = !streaming && messages.length > 0;

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
        renderItem={({ item }) => <MessageBubble message={item} />}
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

      {showDiaryCta && (
        <View style={s.diaryCtaWrap}>
          <Pressable style={s.diaryCta} onPress={() => setDiaryModal(true)}>
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

      <Modal
        visible={diaryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setDiaryModal(false)}
      >
        <Pressable style={s.overlay} onPress={() => setDiaryModal(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Ereignis eintragen</Text>
            <Text style={s.sheetSub}>Im Tagebuch für diesen Betrieb speichern</Text>

            <Text style={s.label}>Beschreibung</Text>
            <TextInput
              style={s.textInput}
              value={diaryDesc}
              onChangeText={setDiaryDesc}
              placeholder="Was ist passiert?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoFocus
            />

            <Text style={s.label}>Kategorie</Text>
            <View style={s.catRow}>
              {DIARY_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.key}
                  style={[s.catChip, diaryCategory === cat.key && s.catChipActive]}
                  onPress={() => setDiaryCategory(cat.key)}
                >
                  <Text style={[s.catChipText, diaryCategory === cat.key && s.catChipTextActive]}>
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
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
