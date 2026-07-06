import { useAuth } from "@clerk/expo";
import { useGetAnalysis, useAskQuestion } from "@workspace/api-client-react";
import type { AnalysisMessage, Chart } from "@workspace/api-client-react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MessageBubble } from "@/components/MessageBubble";
import { ProgressPill } from "@/components/ProgressPill";

type StreamingState = {
  text: string;
  step: string | null;
  chart: Chart | null;
  done: boolean;
};

export default function ChatScreen() {
  const { analysisId, new: isNew } = useLocalSearchParams<{ analysisId: string; new?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { getToken } = useAuth();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const abortRef = useRef<boolean>(false);

  const { data: analysis, refetch } = useGetAnalysis({ analysisId });
  const askQuestion = useAskQuestion();

  useEffect(() => {
    if (analysis?.title) {
      navigation.setOptions({ title: analysis.title });
    }
  }, [analysis?.title]);

  useEffect(() => {
    if (isNew === "1") {
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

    startStreaming();
    await askQuestion.mutateAsync({
      analysisId,
      data: { question },
    });
  }, [input, streaming, askQuestion, analysisId, startStreaming]);

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
  });

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
    </KeyboardAvoidingView>
  );
}
