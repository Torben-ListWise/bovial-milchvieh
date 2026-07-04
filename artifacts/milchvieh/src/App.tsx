import { Switch, Route, Redirect, Router as WouterRouter, useLocation, useSearch } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser, useAuth, useSignIn } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { deDE } from "@clerk/localizations";

// Deutsches "du"-Form — basiert auf deDE, überschreibt alle "Sie/Ihr/Ihnen"-Anreden
const deDULocalization: typeof deDE = {
  ...(deDE as typeof deDE),
  locale: "de-DE",

  footerActionLink__useAnotherMethod: "Andere Methode verwenden",

  signIn: {
    ...(deDE as any).signIn,
    start: {
      ...(deDE as any).signIn?.start,
      subtitleCombined: "Willkommen zurück! Melde dich an, um fortzufahren.",
    },
    alternativeMethods: {
      ...(deDE as any).signIn?.alternativeMethods,
      title: "Andere Anmeldemethode",
      actionText: "Hast du keine davon?",
      subtitle:
        "Hast du Probleme? Du kannst eine der folgenden Methoden zur Anmeldung verwenden.",
      blockButton__backupCode: "Wiederherstellungscode verwenden",
      blockButton__passkey: "Mit Passkey anmelden",
      blockButton__password: "Mit Passwort anmelden",
      blockButton__totp: "Authentifizierungs-App verwenden",
      getHelp: {
        content:
          "Wenn du Schwierigkeiten hast, dich anzumelden, sende uns eine E-Mail — wir helfen dir so schnell wie möglich.",
      },
    },
    emailCode: {
      ...(deDE as any).signIn?.emailCode,
      title: "Überprüfe deinen Posteingang",
      subtitle: "Der Code ist 10 Minuten gültig.",
      formSubtitle: "Der Code ist 10 Minuten gültig.",
    },
    emailCodeMfa: {
      ...(deDE as any).signIn?.emailCodeMfa,
      title: "Überprüfe deinen Posteingang",
      formTitle: "Überprüfe deinen Posteingang",
    },
    emailLink: {
      ...(deDE as any).signIn?.emailLink,
      title: "Überprüfe deinen Posteingang",
      unusedTab: { title: "Du kannst diesen Tab schließen." },
      loading: { subtitle: "Du wirst gleich weitergeleitet …" },
      verified: { subtitle: "Du wirst gleich weitergeleitet …" },
      verifiedSwitchTab: {
        subtitle: "Geh zurück zum ursprünglichen Tab, um fortzufahren.",
        subtitleNewTab: "Geh zurück zum neu geöffneten Tab, um fortzufahren.",
      },
    },
    password: {
      ...(deDE as any).signIn?.password,
      title: "Gib dein Passwort ein",
      actionLink: "Andere Methode verwenden",
    },
    forgotPassword: {
      ...(deDE as any).signIn?.forgotPassword,
      resendButton: "Keinen Code erhalten? Erneut senden",
      subtitle_email: "Gib zunächst den an deine E-Mail gesendeten Code ein.",
      subtitle_phone: "Gib zunächst den auf dein Mobiltelefon geschickten Code ein.",
    },
    passkey: {
      ...(deDE as any).signIn?.passkey,
      title: "Mit Passkey anmelden",
      subtitle:
        "Die Verwendung deines Passkeys bestätigt, dass du es bist. Dein Gerät kann nach deinem Fingerabdruck, Gesicht oder der Bildschirmsperre fragen.",
    },
    newDeviceVerificationNotice:
      "Du meldest dich von einem neuen Gerät an. Wir bitten um eine Überprüfung, um dein Konto sicher zu halten.",
  } as any,

  signInEnterPasswordTitle: "Gib dein Passwort ein",

  signUp: {
    ...(deDE as any).signUp,
    start: {
      ...(deDE as any).signUp?.start,
      title: "Erstelle dein Konto",
      actionText: "Hast du ein Konto?",
    },
    continue: {
      ...(deDE as any).signUp?.continue,
      title: "Fehlende Felder ausfüllen",
      actionText: "Hast du ein Konto?",
    },
    emailCode: {
      ...(deDE as any).signUp?.emailCode,
      title: "Bestätige deine E-Mail",
      formSubtitle:
        "Gib den Bestätigungscode ein, der an deine E-Mail-Adresse gesendet wurde.",
    },
    emailLink: {
      ...(deDE as any).signUp?.emailLink,
      title: "Bestätige deine E-Mail",
      formSubtitle:
        "Verwende den an deine E-Mail-Adresse gesendeten Bestätigungslink.",
      verifiedSwitchTab: {
        subtitle: "Geh zurück zum neu geöffneten Tab, um fortzufahren.",
        subtitleNewTab: "Geh zurück zum vorherigen Tab, um fortzufahren.",
      },
    },
  } as any,
};
import { useEffect, useRef, useState } from "react";
import { useGetCurrentUser, setAuthTokenGetter, useListDatasets } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";

import { AppLayout } from "@/components/layout";
import { DatasetList } from "@/pages/app/datasets";
import { DatasetOverview } from "@/pages/app/overview";
import { UploadPage } from "@/pages/app/upload";
import { AnalysesPage } from "@/pages/app/analyses";
import { WarningsPage } from "@/pages/app/warnings";
import { ReportsPage } from "@/pages/app/reports";
import { RulesPage } from "@/pages/app/rules";
import { SettingsPage } from "@/pages/app/settings";
import { OperatorDashboard } from "@/pages/operator/monitoring";
import BetaTranscriptsPage from "@/pages/operator/beta-transcripts";
import { MasterDataPage } from "@/pages/operator/master-data";
import { KnowledgePage } from "@/pages/operator/knowledge";
import { OperatorTemplatesPage } from "@/pages/operator/templates";
import { FocusAreasOnboardingDialog } from "@/components/FocusAreasOnboardingDialog";
import { GuestAnalysisPage } from "@/pages/app/guest-analysis";
import { ImpressumPage } from "@/pages/Impressum";
import { AGBPage } from "@/pages/AGB";
import { DatenschutzPage } from "@/pages/Datenschutz";
import { LandingPage } from "@/pages/LandingPage";
import { CookieBanner } from "@/components/CookieBanner";
import { UpgradePage } from "@/pages/app/upgrade";
import { TeamAcceptPage } from "@/pages/app/team-accept";
import { NachrichtenPage } from "@/pages/app/nachrichten";
import { NewsEditorPage } from "@/pages/operator/news-editor";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(155 30% 25%)",
    colorForeground: "hsl(160 20% 15%)",
    colorMutedForeground: "hsl(160 10% 40%)",
    colorDanger: "hsl(10 60% 45%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(160 20% 15%)",
    colorNeutral: "hsl(40 20% 88%)",
    fontFamily: "Plus Jakarta Sans, sans-serif",
    borderRadius: "0.625rem",
    fontSize: "16px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[460px] max-w-full overflow-hidden shadow-lg border border-[#e5e1d8]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold text-[#202e29]",
    headerSubtitle: "text-base text-[#4a5c54] mt-1",
    formFieldLabel: "text-sm font-semibold text-[#202e29]",
    formButtonPrimary: "bg-[#2b5242] text-white hover:bg-[#204033] shadow-sm font-semibold h-11 text-base",
    formFieldInput: "border border-[#c8c3b8] rounded-lg h-11 px-3 py-2 focus:ring-2 focus:ring-[#2b5242] text-base text-[#202e29]",
    footerActionLink: "text-[#2b5242] hover:underline font-semibold",
    footerActionText: "text-[#4a5c54] text-sm",
    dividerText: "text-[#4a5c54] text-sm",
    dividerLine: "bg-[#e5e1d8]",
    socialButtonsBlockButton: "border-2 border-[#c8c3b8] bg-white hover:bg-[#f7f5f0] text-[#202e29] h-11 rounded-lg shadow-sm",
    socialButtonsBlockButtonText: "font-semibold text-base text-[#202e29]",
    socialButtonsBlockButtonArrow: "text-[#202e29]",
    logoBox: "h-12 flex justify-center items-center mb-4",
    logoImage: "h-10",
    alertText: "text-sm font-medium",
    alert: "bg-[#fcf5f3] border-[#d95c47] text-[#bd432e]",
    otpCodeFieldInput: "border-2 border-[#c8c3b8] rounded-lg h-14 w-14 text-xl font-bold text-[#202e29] focus:border-[#2b5242]",
    formFieldRow: "mb-4",
    main: "p-7",
    identityPreviewEditButton: "text-[#2b5242] font-semibold",
    formFieldSuccessText: "text-sm text-[#2b5242]",
  },
};

function TeamAcceptPageWrapper() {
  return <TeamAcceptPage />;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}


function AppPortal() {
  const { data: dbUser, isLoading } = useGetCurrentUser();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const search = useSearch();
  const [location] = useLocation();
  const datasetId = new URLSearchParams(search).get("datasetId");

  const role = (dbUser?.role || 'customer') as 'operator' | 'customer';

  // Show onboarding dialog if focusAreas has never been set (null = not yet configured)
  const showOnboarding =
    !onboardingDismissed &&
    !isLoading &&
    dbUser !== undefined &&
    dbUser.focusAreas == null;

  // Fetch datasets to surface auto-detected farm type for the onboarding dialog.
  const { data: datasets } = useListDatasets({
    query: { enabled: showOnboarding },
  });

  // Pick the dataset with the highest detection confidence.
  const bestDetection = datasets
    ?.filter((d) => (d as any).detectedFocusArea != null)
    .reduce<{ area: string; confidence: number } | null>((best, d) => {
      const conf = (d as any).detectedFocusAreaConfidence as number ?? 0;
      if (!best || conf > best.confidence) {
        return { area: (d as any).detectedFocusArea as string, confidence: conf };
      }
      return best;
    }, null);

  // Persist view mode across page reloads via sessionStorage.
  // Operators default to operator view; customers are always customer.
  const [viewMode, setViewModeState] = useState<'operator' | 'customer'>(() => {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem('milchvieh_viewMode');
      if (stored === 'operator' || stored === 'customer') return stored;
    }
    return role;
  });

  const setViewMode = (v: 'operator' | 'customer') => {
    sessionStorage.setItem('milchvieh_viewMode', v);
    setViewModeState(v);
  };

  // Once the user's role is loaded, enforce that non-operators can't stay in operator view.
  const effectiveView = role !== 'operator' ? 'customer' : viewMode;

  if (isLoading) return <div className="h-screen w-full flex items-center justify-center">Laden...</div>;

  return (
    <>
      <FocusAreasOnboardingDialog
        open={showOnboarding}
        onClose={() => setOnboardingDismissed(true)}
        detectedFocusArea={bestDetection?.area}
        detectedFocusAreaConfidence={bestDetection?.confidence}
      />
    <AppLayout
      role={role as 'operator' | 'customer'}
      viewMode={effectiveView}
      onSwitchView={role === 'operator' ? (v) => setViewMode(v) : undefined}
      basePath={basePath}
    >
      <Switch>
        <Route path="/app/monitoring/beta-transcripts" component={BetaTranscriptsPage} />
        <Route path="/app/monitoring" component={OperatorDashboard} />
        <Route path="/app/master-data" component={MasterDataPage} />
        <Route path="/app/knowledge" component={KnowledgePage} />
        <Route path="/app/templates" component={OperatorTemplatesPage} />
        <Route path="/app/datasets" component={DatasetList} />
        <Route path="/app/overview" component={DatasetOverview} />
        <Route path="/app/upload" component={UploadPage} />
        <Route path="/app/analyses" component={AnalysesPage} />
        <Route path="/app/warnings" component={WarningsPage} />
        <Route path="/app/reports" component={ReportsPage} />
        <Route path="/app/rules" component={RulesPage} />
        <Route path="/app/settings" component={SettingsPage} />
        <Route path="/app/nachrichten" component={NachrichtenPage} />
        <Route path="/app/nachrichten-editor" component={NewsEditorPage} />
        <Route path="/app/upgrade" component={UpgradePage} />
        <Route path="/app/semen-planning">
          <Redirect to="/app/analyses" />
        </Route>
        <Route path="/app">
          {effectiveView === 'operator'
            ? <Redirect to="/app/monitoring" />
            : (dbUser as any)?.onboardingCompletedAt == null
              ? <Redirect to="/app/upload" />
              : <Redirect to="/app/overview" />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
    </>
  );
}

function HomeRedirect() {
  const devBypassUserId = import.meta.env.VITE_DEV_BYPASS_USER_ID as string | undefined;
  if (import.meta.env.DEV && devBypassUserId) {
    return <Redirect to="/app" />;
  }
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app/analyses" />
      </Show>
      <Show when="signed-out">
        <LandingPage basePath={basePath} />
        <CookieBanner />
      </Show>
    </>
  );
}

// Shared signal: DevAutoLogin sets this to true once the session is active,
// so ProtectedApp knows it's safe to evaluate isSignedIn without racing.
let devAutoLoginDone = !import.meta.env.DEV ||
  !import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL ||
  !import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD;
const devAutoLoginListeners: Array<() => void> = [];
function notifyDevAutoLoginDone() {
  devAutoLoginDone = true;
  devAutoLoginListeners.forEach((fn) => fn());
  devAutoLoginListeners.length = 0;
}

/**
 * Dev-only auto-login. Set two secrets in the Replit Secrets panel:
 *   VITE_DEV_AUTO_LOGIN_EMAIL    → your dev account email
 *   VITE_DEV_AUTO_LOGIN_PASSWORD → your dev account password
 * Only active when import.meta.env.DEV is true (local dev server).
 * Remove these secrets before publishing to production.
 */
function DevAutoLogin() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signIn } = useSignIn();
  const { setActive } = useClerk();
  const attemptedRef = useRef(false);

  const devEmail = import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL as string | undefined;
  const devPassword = import.meta.env.VITE_DEV_AUTO_LOGIN_PASSWORD as string | undefined;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!devEmail || !devPassword) { notifyDevAutoLoginDone(); return; }
    if (!isLoaded) return;
    if (isSignedIn) { notifyDevAutoLoginDone(); return; }
    if (attemptedRef.current) return;
    if (!signIn || !setActive) return;

    attemptedRef.current = true;

    signIn
      .create({ strategy: "password", identifier: devEmail, password: devPassword } as Parameters<typeof signIn.create>[0])
      .then((result: any) => {
        if (result.status === "complete") {
          return setActive({ session: result.createdSessionId });
        }
      })
      .then(() => notifyDevAutoLoginDone())
      .catch(() => {
        // Credentials wrong or login failed — unblock and show normal login.
        // Do NOT reset attemptedRef — prevents infinite retry loop (→ account lockout).
        notifyDevAutoLoginDone();
      });
  }, [isLoaded, isSignedIn, signIn, setActive, devEmail, devPassword]);

  return null;
}

function ProtectedApp() {
  const { isSignedIn, isLoaded } = useAuth();
  const search = useSearch();
  const [location] = useLocation();
  const devBypassUserId = import.meta.env.VITE_DEV_BYPASS_USER_ID as string | undefined;

  // Dev bypass: skip Clerk entirely, render app directly.
  if (import.meta.env.DEV && devBypassUserId) {
    return <AppPortal />;
  }

  if (!isLoaded) {
    return <div className="h-screen w-full flex items-center justify-center">Laden...</div>;
  }

  if (isSignedIn) {
    return <AppPortal />;
  }

  // Allow unauthenticated users to read a shared analysis
  const analysisId = new URLSearchParams(search).get("analysisId");
  if (analysisId && location.startsWith("/app/analyses")) {
    return <GuestAnalysisPage analysisId={analysisId} />;
  }

  return <Redirect to="/" />;
}

// Wires Clerk's getToken into the API client so every request carries a Bearer token.
// In dev bypass mode, returns a static dev-bypass token instead of a Clerk JWT.
// Also invalidates all cached queries once the token is ready so they refetch
// instead of staying stuck in error state from the pre-auth 401 responses.
function ClerkAuthTokenSetup() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const devBypassUserId = import.meta.env.VITE_DEV_BYPASS_USER_ID as string | undefined;

  useEffect(() => {
    if (import.meta.env.DEV && devBypassUserId) {
      const token = `dev-bypass-${devBypassUserId}`;
      setAuthTokenGetter(() => Promise.resolve(token));
      queryClient.invalidateQueries();
    } else {
      setAuthTokenGetter(() => getToken());
    }
    return () => setAuthTokenGetter(null);
  }, [getToken, devBypassUserId, queryClient]);

  // In normal Clerk mode: flush stale queries once signed in.
  useEffect(() => {
    if (!devBypassUserId && isSignedIn) {
      queryClient.invalidateQueries();
    }
  }, [isSignedIn, queryClient, devBypassUserId]);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

const queryClient = new QueryClient();

function ClerkProviderWithRoutes() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={deDULocalization}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthTokenSetup />
        <ClerkQueryClientCacheInvalidator />
        <DevAutoLogin />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/impressum" component={ImpressumPage} />
            <Route path="/agb" component={AGBPage} />
            <Route path="/datenschutz" component={DatenschutzPage} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/team/accept/:token" component={TeamAcceptPageWrapper} />
            <Route path="/app" component={ProtectedApp} />
            <Route path="/app/*" component={ProtectedApp} />
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;