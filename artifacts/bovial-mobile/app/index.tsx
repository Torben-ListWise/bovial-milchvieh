import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

export default function IndexRedirect() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;

  if (isSignedIn) {
    return <Redirect href="/(app)/(tabs)/" />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
