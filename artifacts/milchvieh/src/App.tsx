import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser, useAuth } from '@clerk/react';
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
import { ArrowRight, MessageCircle, ShieldCheck } from "lucide-react";

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
import { MasterDataPage } from "@/pages/operator/master-data";
import { KnowledgePage } from "@/pages/operator/knowledge";
import { OperatorTemplatesPage } from "@/pages/operator/templates";
import { FocusAreasOnboardingDialog } from "@/components/FocusAreasOnboardingDialog";

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
    socialButtonsBlockButton: "border border-[#c8c3b8] hover:bg-[#f7f5f0] text-[#202e29] h-11",
    socialButtonsBlockButtonText: "font-semibold text-base",
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

function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card">
        <div className="flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8" />
          <span className="font-bold text-lg text-primary">Milchvieh Assistent</span>
        </div>
        <div className="flex items-center gap-4">
          <a href={`${basePath}/sign-in`} className="text-sm font-medium hover:underline text-foreground">Anmelden</a>
          <a href={`${basePath}/sign-up`} className="text-sm font-medium bg-primary text-primary-foreground px-5 py-2 rounded-full shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">Registrieren</a>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="text-left space-y-8">
            <h1 className="text-5xl font-bold tracking-tight text-foreground leading-[1.1]">
              Der kluge Assistent für deine Betriebsdaten
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Lade deine Betriebsdaten hoch — egal ob Milchvieh, Schweine, Ackerbau oder Mischbetrieb. Stelle Fragen in einfachem Deutsch. Erhalte klare, fundierte Antworten basierend auf deinen echten Zahlen.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a href={`${basePath}/sign-up`} className="inline-flex items-center justify-center gap-2 text-lg font-medium bg-primary text-primary-foreground px-8 py-4 rounded-lg hover:bg-primary/90 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
                Jetzt kostenlos starten
                <ArrowRight className="w-5 h-5" />
              </a>
              <a href={`${basePath}/sign-in`} className="inline-flex items-center justify-center text-lg font-medium bg-secondary text-secondary-foreground px-8 py-4 rounded-lg hover:bg-secondary/80 transition-all">
                Anmelden
              </a>
            </div>
            <div className="grid grid-cols-2 gap-6 pt-8 border-t border-border/50">
              <div>
                <div className="bg-primary/10 rounded-lg p-2 w-fit mb-3">
                  <MessageCircle className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Einfach Fragen</h3>
                <p className="text-sm text-muted-foreground">„Warum ist die Zellzahl in Laktation 2 gestiegen?“ – der Assistent antwortet auf Deutsch.</p>
              </div>
              <div>
                <div className="bg-primary/10 rounded-lg p-2 w-fit mb-3">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Geprüfte Daten</h3>
                <p className="text-sm text-muted-foreground">Jede Zahl ist belegt. Keine erfundenen Werte, sondern direkte Verweise auf deine Rohdaten.</p>
              </div>
            </div>
          </div>
          <div className="relative">
            {/* Abstract representation of the app interface */}
            <div className="aspect-[4/3] bg-card rounded-2xl shadow-2xl ring-1 ring-border/50 overflow-hidden flex flex-col">
              <div className="h-12 border-b flex items-center px-4 gap-2 bg-muted/30">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="flex-1 p-6 space-y-4 bg-[url('/noise.png')] relative">
                <div className="w-3/4 h-8 bg-muted rounded-md mb-8"></div>
                <div className="flex gap-4">
                  <div className="w-1/3 h-24 bg-primary/10 border border-primary/20 rounded-lg flex flex-col justify-center p-4">
                    <div className="w-1/2 h-4 bg-primary/30 rounded mb-2"></div>
                    <div className="w-3/4 h-6 bg-primary/40 rounded"></div>
                  </div>
                  <div className="w-1/3 h-24 bg-muted/50 rounded-lg flex flex-col justify-center p-4">
                    <div className="w-1/2 h-4 bg-muted/80 rounded mb-2"></div>
                    <div className="w-3/4 h-6 bg-muted rounded"></div>
                  </div>
                  <div className="w-1/3 h-24 bg-muted/50 rounded-lg flex flex-col justify-center p-4">
                    <div className="w-1/2 h-4 bg-muted/80 rounded mb-2"></div>
                    <div className="w-3/4 h-6 bg-muted rounded"></div>
                  </div>
                </div>
                <div className="w-full h-40 bg-muted/30 rounded-lg mt-4 border border-dashed border-muted-foreground/20 flex items-end px-4 gap-2 pb-4">
                  <div className="w-full h-[40%] bg-primary/40 rounded-t-sm"></div>
                  <div className="w-full h-[60%] bg-primary/50 rounded-t-sm"></div>
                  <div className="w-full h-[80%] bg-primary/60 rounded-t-sm"></div>
                  <div className="w-full h-[50%] bg-primary/50 rounded-t-sm"></div>
                  <div className="w-full h-[30%] bg-primary/40 rounded-t-sm"></div>
                  <div className="w-full h-[70%] bg-primary/60 rounded-t-sm"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function AppPortal() {
  const { data: dbUser, isLoading } = useGetCurrentUser();
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

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
        <Route path="/app">
          {effectiveView === 'operator'
            ? <Redirect to="/app/monitoring" />
            : <Redirect to="/app/analyses" />}
        </Route>
      </Switch>
    </AppLayout>
    </>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app/analyses" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedApp() {
  return (
    <>
      <Show when="signed-in">
        <AppPortal />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

// Wires Clerk's getToken into the API client so every request carries a Bearer token.
// Also invalidates all cached queries once the token is ready so they refetch
// instead of staying stuck in error state from the pre-auth 401 responses.
function ClerkAuthTokenSetup() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  // Once signed in, flush any stale 401-error queries so they refetch with the token.
  useEffect(() => {
    if (isSignedIn) {
      queryClient.invalidateQueries();
    }
  }, [isSignedIn, queryClient]);

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
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
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