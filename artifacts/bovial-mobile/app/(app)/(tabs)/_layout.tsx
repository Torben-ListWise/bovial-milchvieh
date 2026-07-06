import Ionicons from "@expo/vector-icons/Ionicons";
import { NativeTabs, Icon, Label, VectorIcon } from "expo-router/unstable-native-tabs";
import { Platform, useColorScheme } from "react-native";
import colors from "@/constants/colors";

const TABS: {
  name: string;
  label: string;
  sf: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { name: "index", label: "Betriebe", sf: "house", icon: "home-outline" },
  { name: "analyse", label: "Analysen", sf: "bubble.left.and.bubble.right", icon: "chatbubbles-outline" },
  { name: "berichte", label: "Berichte", sf: "chart.bar", icon: "bar-chart-outline" },
  { name: "diary", label: "Tagebuch", sf: "book", icon: "journal-outline" },
  { name: "einstellungen", label: "Einstellungen", sf: "gearshape", icon: "settings-outline" },
];

export default function TabsLayout() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? colors.dark : colors.light;

  return (
    <NativeTabs
      blurEffect={Platform.OS === "ios" ? "systemMaterial" : undefined}
      tintColor={c.primary}
      backgroundColor={Platform.OS === "ios" ? null : c.card}
      iconColor={{ default: c.mutedForeground as string, selected: c.primary as string }}
      labelStyle={{
        default: { fontSize: 11, color: c.mutedForeground as string },
        selected: { fontSize: 11, color: c.primary as string },
      }}
    >
      {TABS.map(({ name, label, sf, icon }) => (
        <NativeTabs.Trigger
          key={name}
          name={name}
          options={
            Platform.OS === "ios"
              ? {
                  title: label,
                  icon: { sf: sf as any },
                }
              : { title: label }
          }
        >
          {Platform.OS !== "ios" && (
            <>
              <Icon src={<VectorIcon family={Ionicons} name={icon} />} />
              <Label>{label}</Label>
            </>
          )}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
