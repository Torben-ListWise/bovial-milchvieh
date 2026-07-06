import { useSignUp } from "@clerk/expo";
import { Link, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  const handleSubmit = async () => {
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    if (!error) await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/");
          if (!url.startsWith("http")) router.replace(url as any);
        },
      });
    }
  };

  const s = createStyles(colors);

  if (
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0
  ) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20 }]}>
        <Text style={s.title}>E-Mail bestätigen</Text>
        <Text style={s.subtitle}>Wir haben einen Code an {email} gesendet</Text>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          placeholder="6-stelliger Code"
          placeholderTextColor={colors.mutedForeground}
        />
        {errors.fields.code && <Text style={s.error}>{errors.fields.code.message}</Text>}
        <Pressable
          style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
          onPress={handleVerify}
          disabled={fetchStatus === "fetching"}
        >
          {fetchStatus === "fetching" ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.buttonText}>Bestätigen</Text>
          )}
        </Pressable>
        <Pressable style={s.linkButton} onPress={() => signUp.verifications.sendEmailCode()}>
          <Text style={s.linkText}>Neuen Code senden</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.logoContainer}>
          <View style={s.logoCircle}>
            <Text style={s.logoText}>B</Text>
          </View>
          <Text style={s.appName}>Bovial</Text>
        </View>

        <Text style={s.title}>Konto erstellen</Text>
        <Text style={s.subtitle}>Starte deine Milchvieh-Analyse</Text>

        <Text style={s.label}>E-Mail</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="deine@email.de"
          placeholderTextColor={colors.mutedForeground}
          autoComplete="email"
        />
        {errors.fields.emailAddress && <Text style={s.error}>{errors.fields.emailAddress.message}</Text>}

        <Text style={s.label}>Passwort</Text>
        <TextInput
          style={s.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Mind. 8 Zeichen"
          placeholderTextColor={colors.mutedForeground}
          autoComplete="new-password"
        />
        {errors.fields.password && <Text style={s.error}>{errors.fields.password.message}</Text>}

        <Pressable
          style={({ pressed }) => [
            s.button,
            (!email || !password || fetchStatus === "fetching") && s.buttonDisabled,
            pressed && s.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={!email || !password || fetchStatus === "fetching"}
        >
          {fetchStatus === "fetching" ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.buttonText}>Registrieren</Text>
          )}
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerText}>Bereits ein Konto? </Text>
          <Link href="/sign-in">
            <Text style={s.linkText}>Anmelden</Text>
          </Link>
        </View>

        <View nativeID="clerk-captcha" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flexGrow: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: 40,
    },
    logoCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    logoText: {
      fontSize: 32,
      fontFamily: "Inter_700Bold",
      color: "#ffffff",
    },
    appName: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    title: {
      fontSize: 26,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 32,
    },
    label: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      marginBottom: 8,
    },
    input: {
      backgroundColor: colors.secondary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    error: {
      color: colors.destructive,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      marginTop: -10,
      marginBottom: 12,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
    },
    linkButton: {
      alignItems: "center",
      paddingVertical: 12,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
    },
    footerText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    linkText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
  });
}
