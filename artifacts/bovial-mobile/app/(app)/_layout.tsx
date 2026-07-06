import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export default function AppLayout() {
  const { isSignedIn, getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="farms/[datasetId]"
        options={{
          headerShown: true,
          headerBackTitle: "Betriebe",
          title: "",
        }}
      />
      <Stack.Screen
        name="chat/[analysisId]"
        options={{
          headerShown: true,
          headerBackTitle: "Zurück",
          title: "",
        }}
      />
    </Stack>
  );
}
