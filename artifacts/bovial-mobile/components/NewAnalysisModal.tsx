import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const SUGGESTIONS = [
  "Wie entwickelt sich die Milchleistung in den letzten 3 Monaten?",
  "Welche Kühe haben die höchste Zellzahl?",
  "Wie ist die Brunsterkennung und Konzeptionsrate?",
  "Analysiere die Futterkosten pro Liter Milch.",
];

type Props = {
  visible: boolean;
  farmName: string;
  onClose: () => void;
  onSubmit: (question: string) => void;
  isLoading: boolean;
};

export function NewAnalysisModal({ visible, farmName, onClose, onSubmit, isLoading }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState("");

  const handleSubmit = () => {
    const q = question.trim();
    if (!q || isLoading) return;
    onSubmit(q);
    setQuestion("");
  };

  const handleSuggestion = (s: string) => setQuestion(s);

  const s = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "#00000066",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: insets.bottom + 20,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 20,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    subtitle: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 10,
    },
    input: {
      backgroundColor: colors.secondary,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
    },
    suggestionsLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    suggestions: {
      gap: 6,
      marginBottom: 20,
    },
    suggestionBtn: {
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    suggestionText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      alignItems: "center",
    },
    submitBtnDisabled: { opacity: 0.5 },
    submitText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "position" : undefined}>
              <View style={s.sheet}>
                <View style={s.handle} />
                <View style={s.header}>
                  <View>
                    <Text style={s.title}>Neue Analyse</Text>
                    <Text style={s.subtitle}>{farmName}</Text>
                  </View>
                  <Pressable style={s.closeBtn} onPress={onClose}>
                    <Ionicons name="close" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>

                <Text style={s.label}>Frage</Text>
                <TextInput
                  style={s.input}
                  value={question}
                  onChangeText={setQuestion}
                  placeholder="Was möchtest du analysieren?"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  autoFocus
                />

                <Text style={s.suggestionsLabel}>Vorschläge</Text>
                <View style={s.suggestions}>
                  {SUGGESTIONS.slice(0, 3).map((sug) => (
                    <Pressable key={sug} style={s.suggestionBtn} onPress={() => handleSuggestion(sug)}>
                      <Text style={s.suggestionText} numberOfLines={2}>{sug}</Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  style={[s.submitBtn, (!question.trim() || isLoading) && s.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={!question.trim() || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={s.submitText}>Analyse starten</Text>
                  )}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
