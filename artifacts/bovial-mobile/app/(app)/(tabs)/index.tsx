import { useAuth } from "@clerk/expo";
import { useListDatasets, useCreateDataset } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FarmCard } from "@/components/FarmCard";
import { Ionicons } from "@expo/vector-icons";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: datasets, isLoading, isError, refetch, isFetching } = useListDatasets();
  const createDataset = useCreateDataset();

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert("Fehler", "Bitte gib einen Betriebsnamen ein.");
      return;
    }
    try {
      await createDataset.mutateAsync({ data: { name, description: newDesc.trim() || undefined } });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      refetch();
    } catch {
      Alert.alert("Fehler", "Betrieb konnte nicht angelegt werden.");
    }
  };

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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    addBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    list: {
      padding: 16,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    centerText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 32,
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
    fab: {
      position: "absolute",
      bottom: 24,
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 8,
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
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 20,
    },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 6,
    },
    input: {
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
    },
    sheetBtn: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    sheetBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    sheetBtnDisabled: {
      opacity: 0.5,
    },
  });

  if (isLoading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[s.container, s.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
        <Text style={s.errorText}>Fehler beim Laden der Betriebe</Text>
        <Pressable style={s.retryBtn} onPress={() => refetch()}>
          <Text style={s.retryText}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>Betriebe</Text>
          <Pressable style={s.addBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={datasets ?? []}
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
          <FarmCard
            dataset={item}
            onPress={() => router.push(`/farms/${item.id}` as any)}
          />
        )}
        ListEmptyComponent={
          <View style={[s.center, { paddingTop: 60 }]}>
            <Ionicons name="leaf-outline" size={56} color={colors.mutedForeground} />
            <Text style={s.centerText}>
              Noch keine Betriebe angelegt.{"\n"}Tippe auf + um einen neuen Betrieb hinzuzufügen.
            </Text>
          </View>
        }
      />

      <Modal
        visible={showCreate}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <Pressable style={s.overlay} onPress={() => setShowCreate(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Neuer Betrieb</Text>

            <Text style={s.label}>Betriebsname *</Text>
            <TextInput
              style={s.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="z.B. Musterhof GmbH"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
            />

            <Text style={s.label}>Beschreibung (optional)</Text>
            <TextInput
              style={[s.input, { minHeight: 80 }]}
              value={newDesc}
              onChangeText={setNewDesc}
              placeholder="Kurze Beschreibung des Betriebs…"
              placeholderTextColor={colors.mutedForeground}
              multiline
            />

            <Pressable
              style={[s.sheetBtn, (!newName.trim() || createDataset.isPending) && s.sheetBtnDisabled]}
              onPress={handleCreate}
              disabled={!newName.trim() || createDataset.isPending}
            >
              {createDataset.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={s.sheetBtnText}>Betrieb anlegen</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
