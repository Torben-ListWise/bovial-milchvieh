import { useAuth } from "@clerk/expo";
import { useListDatasets } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React from "react";
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
import { useColors } from "@/hooks/useColors";
import { FarmCard } from "@/components/FarmCard";
import { Ionicons } from "@expo/vector-icons";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();

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
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.secondary,
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
    emptyIcon: {
      marginBottom: 8,
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
          <View style={s.headerActions}>
            <Pressable style={s.iconBtn} onPress={() => signOut()}>
              <Ionicons name="log-out-outline" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>
      </View>

      <FlatList
        data={datasets ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!(datasets && datasets.length > 0)}
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
          <View style={s.center}>
            <Ionicons name="leaf-outline" size={56} color={colors.mutedForeground} style={s.emptyIcon} />
            <Text style={s.centerText}>
              Noch keine Betriebe angelegt.{"\n"}Öffne die Web-App um einen Betrieb hinzuzufügen.
            </Text>
          </View>
        }
      />
    </View>
  );
}
