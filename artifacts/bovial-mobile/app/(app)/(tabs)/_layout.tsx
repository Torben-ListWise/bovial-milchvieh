import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useColorScheme } from "react-native";
import colors from "@/constants/colors";

export default function TabsLayout() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? colors.dark : colors.light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.card,
          borderTopColor: c.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Betriebe",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="diary"
        options={{
          title: "Tagebuch",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="journal-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
