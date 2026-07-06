import { useSignIn } from "@clerk/expo";
import { useAuth } from "@clerk/expo";
import { useEffect, useRef } from "react";

/**
 * Dev-only auto-login for the mobile app.
 * Set two secrets in the Replit Secrets panel (prefixed EXPO_PUBLIC_):
 *   EXPO_PUBLIC_DEV_AUTO_LOGIN_EMAIL    → your dev account email
 *   EXPO_PUBLIC_DEV_AUTO_LOGIN_PASSWORD → your dev account password
 * Only active when __DEV__ is true (Expo dev build).
 */
export function useDevAutoLogin() {
  const { isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const attemptedRef = useRef(false);

  const devEmail = process.env.EXPO_PUBLIC_DEV_AUTO_LOGIN_EMAIL;
  const devPassword = process.env.EXPO_PUBLIC_DEV_AUTO_LOGIN_PASSWORD;

  useEffect(() => {
    if (!__DEV__) return;
    if (!devEmail || !devPassword) return;
    if (isSignedIn) return;
    if (attemptedRef.current) return;
    if (!signIn) return;

    attemptedRef.current = true;

    (async () => {
      try {
        const { error } = await signIn.password({ emailAddress: devEmail, password: devPassword });
        if (error) return;
        if (signIn.status === "complete") {
          await signIn.finalize({ navigate: () => {} });
        }
      } catch {
        // Credentials wrong or login failed — show normal login screen.
        // IMPORTANT: do NOT reset attemptedRef here — causes infinite retry loop
        // which triggers Clerk account lockout after ~100 attempts.
      }
    })();
  }, [isSignedIn, signIn, devEmail, devPassword]);
}
