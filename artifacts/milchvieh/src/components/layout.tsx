import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useGetDataset, useGetCurrentUser, useUpdateMe, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Home, 
  Upload, 
  MessageSquare, 
  AlertTriangle, 
  FileText, 
  Settings, 
  Sliders, 
  Database,
  Activity,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ArrowLeftRight,
  BookOpen,
  LayoutList,
  Milk,
  Zap,
  Wheat,
  Menu,
  X,
  Users,
  Sun,
  Moon,
  FlaskConical,
  Newspaper,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { AiIcon } from "@/components/AiIcon";
import { useTheme } from "@/hooks/useTheme";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type HostEntry = { hostUserId: string; hostName: string; hostEmail: string | null };

function useMyHosts() {
  const { getToken } = useAuth();
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const devBypassUserId = import.meta.env.VITE_DEV_BYPASS_USER_ID as string | undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = (import.meta.env.DEV && devBypassUserId)
          ? `dev-bypass-${devBypassUserId}`
          : await getToken();
        const res = await fetch(`${API_BASE}/api/team/my-hosts`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled && res.ok) {
          setHosts(await res.json());
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, []);

  return hosts;
}

const SECTOR_META: Record<string, { icon: React.ElementType; label: string }> = {
  dairy:  { icon: Milk,  label: "Milchvieh" },
  biogas: { icon: Zap,   label: "Biogas" },
  arable: { icon: Wheat, label: "Ackerbau" },
};

function DatasetAwareHeader({
  viewMode,
  navItems,
  currentPath,
  datasetId,
  onOpenMobileMenu,
}: {
  viewMode: 'customer' | 'operator';
  navItems: { name: string; href: string }[];
  currentPath: string;
  datasetId: string | null;
  onOpenMobileMenu: () => void;
}) {
  const { data: dataset } = useGetDataset(datasetId!, {
    query: { enabled: !!datasetId && viewMode === 'customer' },
  });
  const { isDark, setTheme, toggle } = useTheme();
  const { data: dbUser } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const serverSyncedRef = useRef(false);

  useEffect(() => {
    if (!serverSyncedRef.current && dbUser?.themePreference) {
      serverSyncedRef.current = true;
      setTheme(dbUser.themePreference as "light" | "dark");
    } else if (!serverSyncedRef.current && dbUser !== undefined) {
      serverSyncedRef.current = true;
    }
  }, [dbUser, setTheme]);

  const handleToggle = useCallback(() => {
    toggle();
    const next = isDark ? "light" : "dark";
    updateMe.mutate({ themePreference: next }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
      },
    });
  }, [isDark, toggle, updateMe, queryClient]);

  const sectorMeta = dataset ? (SECTOR_META[(dataset as any).sector ?? "dairy"] ?? SECTOR_META.dairy) : null;

  const isAnalysesPage = currentPath.startsWith('/app/analyses');

  return (
    <header className="h-14 md:h-16 border-b border-white/[0.06] bg-card/80 backdrop-blur-xl flex items-center px-3 md:px-6 shrink-0 gap-2 md:gap-3">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenMobileMenu}
        aria-label="Navigation öffnen"
        className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0 -ml-1"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex items-center text-sm text-muted-foreground min-w-0">
        <span className="hidden md:inline">{viewMode === 'operator' ? 'Operator Dashboard' : 'Datenanalyse'}</span>
        <ChevronRight className="w-4 h-4 mx-2 hidden md:block shrink-0" />
        <span className="text-foreground font-medium truncate">
          {navItems.find(i => currentPath.startsWith(i.href))?.name || "App"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {isAnalysesPage && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary border border-border px-2.5 py-1 rounded-full" title="Antworten werden durch KI (Anthropic Claude) generiert und können Fehler enthalten. (EU AI Act Art. 50)">
            <AiIcon size={14} className="shrink-0 text-primary" />
            <span className="hidden sm:inline">KI-generierte Antworten</span>
          </span>
        )}
        {sectorMeta && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">
            <sectorMeta.icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{sectorMeta.label}</span>
          </span>
        )}
        <button
          onClick={handleToggle}
          aria-label={isDark ? "Helles Design aktivieren" : "Dunkles Design aktivieren"}
          title={isDark ? "Helles Design" : "Dunkles Design"}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
  role: 'customer' | 'operator';
  viewMode: 'customer' | 'operator';
  onSwitchView?: (v: 'customer' | 'operator') => void;
  basePath: string;
}

export function AppLayout({ children, role, viewMode, onSwitchView, basePath }: AppLayoutProps) {
  const [location, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const hosts = useMyHosts();

  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("navCollapsed") !== "false";
  });

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Swipe-to-open from left edge
  const swipeTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleRootTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeTouchStartRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleRootTouchEnd(e: React.TouchEvent) {
    if (!swipeTouchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeTouchStartRef.current.x;
    const dy = Math.abs(t.clientY - swipeTouchStartRef.current.y);
    swipeTouchStartRef.current = null;

    if (dy > Math.abs(dx)) return; // more vertical → scroll, not swipe

    // Swipe right from left edge → open drawer
    if (dx > 60 && e.changedTouches[0].clientX - dx < 40) {
      setMobileDrawerOpen(true);
    }
    // Swipe left while drawer open → close drawer
    if (dx < -60 && mobileDrawerOpen) {
      setMobileDrawerOpen(false);
    }
  }

  // Close drawer on route change
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location]);

  function toggleNav() {
    setNavCollapsed((prev) => {
      localStorage.setItem("navCollapsed", String(!prev));
      return !prev;
    });
  }

  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const datasetId = searchParams.get("datasetId");
  const hostId = searchParams.get("hostId");
  const datasetQuery = datasetId
    ? hostId
      ? `?datasetId=${datasetId}&hostId=${hostId}`
      : `?datasetId=${datasetId}`
    : hostId
      ? `?hostId=${hostId}`
      : "";

  const currentPath = location.startsWith(basePath) 
    ? location.slice(basePath.length) || "/" 
    : location;

  const isFullHeightPage = currentPath.startsWith('/app/analyses');

  const isGuestMode = !!hostId;

  const allCustomerNav = [
    { name: "Start", href: "/app/overview", icon: Home, preserveDataset: true, guestHidden: false },
    { name: "Analysen", href: "/app/analyses", icon: MessageSquare, preserveDataset: true, guestHidden: false },
    { name: "Regeln", href: "/app/rules", icon: Sliders, preserveDataset: true, guestHidden: true },
    { name: "Einstellungen", href: "/app/settings", icon: Settings, preserveDataset: false, guestHidden: false },
  ];
  const customerNav = isGuestMode
    ? allCustomerNav.filter((item) => !item.guestHidden)
    : allCustomerNav;

  const operatorNav = [
    { name: "Monitoring", href: "/app/monitoring", icon: Activity, preserveDataset: false },
    { name: "Beta-Transkripte", href: "/app/monitoring/beta-transcripts", icon: FlaskConical, preserveDataset: false },
    { name: "Stammdaten", href: "/app/master-data", icon: Database, preserveDataset: false },
    { name: "Wissensbibliothek", href: "/app/knowledge", icon: BookOpen, preserveDataset: false },
    { name: "Auswertungsvorlagen", href: "/app/templates", icon: LayoutList, preserveDataset: false },
    { name: "Nachrichten", href: "/app/nachrichten-editor", icon: Newspaper, preserveDataset: false },
    { name: "Referenzanalysen", href: "/app/reference-analyses", icon: Sparkles, preserveDataset: false },
    { name: "Credit-Dashboard", href: "/app/credit-dashboard", icon: BarChart3, preserveDataset: false },
  ];

  const navItems = viewMode === 'operator' ? operatorNav : customerNav;

  const handleSwitchView = () => {
    if (!onSwitchView) return;
    const next = viewMode === 'operator' ? 'customer' : 'operator';
    onSwitchView(next);
    setLocation(next === 'operator' ? '/app/monitoring' : '/app/analyses');
  };

  function NavItems({ onClick }: { onClick?: () => void }) {
    return (
      <>
        <ul className="space-y-0.5 px-2">
          {navItems.map((item) => {
            const isActive = currentPath.startsWith(item.href);
            const Icon = item.icon;
            let href: string;
            if (item.preserveDataset) {
              href = `${item.href}${datasetQuery}`;
            } else {
              href = item.href;
            }
            return (
              <li key={item.name}>
                <Link href={href}>
                  <div
                    onClick={onClick}
                    title={navCollapsed ? item.name : undefined}
                    className={cn(
                      "flex items-center rounded-md text-sm font-medium transition-all duration-150 cursor-pointer min-h-[44px] md:min-h-0",
                      navCollapsed ? "px-2 py-2 justify-center md:min-h-0" : "px-3 py-2",
                      isActive 
                        ? "border-l-2 border-primary bg-primary/10 text-primary shadow-[0_0_10px_0_rgba(52,211,153,0.15)]" 
                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("w-5 h-5 md:w-4 md:h-4 shrink-0", !navCollapsed && "mr-3")} />
                    {!navCollapsed && item.name}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {/* Shared hosts section (only for customer view) */}
        {viewMode === 'customer' && hosts.length > 0 && (
          <div className="px-2 mt-3">
            {!navCollapsed && (
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 mb-1">
                Geteilte Betriebe
              </p>
            )}
            <ul className="space-y-0.5">
              {hosts.map((host) => {
                const hostHref = `/app/datasets?hostId=${host.hostUserId}`;
                // Active if we're anywhere in the guest context for this host
                const isActive = hostId === host.hostUserId;
                return (
                  <li key={host.hostUserId}>
                    <Link href={hostHref}>
                      <div
                        onClick={onClick}
                        title={navCollapsed ? host.hostName : undefined}
                        className={cn(
                          "flex items-center rounded-md text-sm font-medium transition-colors cursor-pointer min-h-[44px] md:min-h-0",
                          navCollapsed ? "px-2 py-2 justify-center md:min-h-0" : "px-3 py-2",
                          isActive
                            ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        )}
                      >
                        <Users className={cn("w-5 h-5 md:w-4 md:h-4 shrink-0", !navCollapsed && "mr-3")} />
                        {!navCollapsed && (
                          <span className="truncate">{host.hostName}</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      onTouchStart={handleRootTouchStart}
      onTouchEnd={handleRootTouchEnd}
    >
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "border-r border-white/[0.06] bg-card/90 backdrop-blur-xl flex-col transition-all duration-200 shrink-0 hidden md:flex",
          navCollapsed ? "w-12" : "w-56"
        )}
      >
        {/* Header / logo + toggle */}
        <div className="h-16 flex items-center border-b border-white/[0.06] shrink-0 px-2 gap-1">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8 shrink-0" />
          {!navCollapsed && (
            <span className="font-bold text-primary truncate ml-1 flex-1 text-sm">
              Bovial
            </span>
          )}
          <button
            onClick={toggleNav}
            title={navCollapsed ? "Navigation aufklappen" : "Navigation einklappen"}
            className={cn(
              "p-1 rounded hover:bg-secondary text-muted-foreground transition-colors shrink-0",
              navCollapsed && "mx-auto"
            )}
          >
            {navCollapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronLeft className="w-4 h-4" />
            }
          </button>
        </div>

        {/* View toggle for operators */}
        {role === 'operator' && onSwitchView && (
          <div className="px-2 pt-2">
            <button
              onClick={handleSwitchView}
              title={navCollapsed ? (viewMode === 'operator' ? 'Zur Kunden-Ansicht wechseln' : 'Zur Operator-Ansicht wechseln') : undefined}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs font-medium bg-primary/5 border border-primary/20 text-primary hover:bg-primary/10 transition-colors",
                navCollapsed && "justify-center"
              )}
            >
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
              {!navCollapsed && (viewMode === 'operator' ? 'Zur Kunden-Ansicht wechseln' : 'Zur Operator-Ansicht wechseln')}
            </button>
          </div>
        )}
        
        <nav className="flex-1 overflow-y-auto py-3">
          <NavItems />
        </nav>

        <hr className="my-0 border-border/40 mx-2" />

        {/* Legal footer links */}
        {!navCollapsed && (
          <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
            <Link href="/impressum">
              <a className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Impressum</a>
            </Link>
            <Link href="/agb">
              <a className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">AGB</a>
            </Link>
            <Link href="/datenschutz">
              <a className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Datenschutz</a>
            </Link>
          </div>
        )}

        <div className="p-2 border-t">
          <div
            className={cn(
              "flex items-center rounded-md bg-secondary/50",
              navCollapsed ? "p-1.5 justify-center" : "p-3"
            )}
          >
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-primary font-bold shrink-0 text-sm"
              title={navCollapsed ? (user?.firstName || user?.emailAddresses[0]?.emailAddress || "Benutzer") : undefined}
            >
              {user?.firstName?.charAt(0) || user?.emailAddresses[0]?.emailAddress?.charAt(0) || "U"}
            </div>
            {!navCollapsed && (
              <div className="flex-1 min-w-0 ml-3">
                <p className="text-sm font-medium text-foreground truncate">
                  {user?.firstName || "Benutzer"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.emailAddresses[0]?.emailAddress}
                </p>
              </div>
            )}
          </div>
          <button 
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            title={navCollapsed ? "Abmelden" : undefined}
            className={cn(
              "mt-1 w-full flex items-center py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition-colors",
              navCollapsed ? "justify-center px-2" : "px-3"
            )}
          >
            <LogOut className={cn("w-4 h-4 shrink-0", !navCollapsed && "mr-3")} />
            {!navCollapsed && "Abmelden"}
          </button>
        </div>
      </aside>

      {/* ── Mobile drawer overlay ────────────────────────────────────────────── */}
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 md:hidden transition-opacity duration-200",
          mobileDrawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-card/95 backdrop-blur-xl flex flex-col shadow-xl border-r border-white/[0.06] transition-transform duration-200 md:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Drawer header */}
        <div className="h-14 flex items-center border-b border-white/[0.06] shrink-0 px-4 gap-3">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8 shrink-0" />
          <span className="font-bold text-primary truncate flex-1 text-sm">
            Bovial
          </span>
          <button
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Navigation schließen"
            className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View toggle for operators */}
        {role === 'operator' && onSwitchView && (
          <div className="px-3 pt-3">
            <button
              onClick={handleSwitchView}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium bg-primary/5 border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
            >
              <ArrowLeftRight className="w-4 h-4 shrink-0" />
              {viewMode === 'operator' ? 'Zur Kunden-Ansicht wechseln' : 'Zur Operator-Ansicht wechseln'}
            </button>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = currentPath.startsWith(item.href);
              const Icon = item.icon;
              let href: string;
              if (item.preserveDataset) {
                href = `${item.href}${datasetQuery}`;
              } else {
                href = item.href;
              }
              return (
                <li key={item.name}>
                  <Link href={href}>
                    <div
                      onClick={() => setMobileDrawerOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer min-h-[48px]",
                        isActive 
                          ? "border-l-2 border-primary bg-primary/8 text-primary" 
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      {item.name}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Shared hosts (mobile) */}
          {viewMode === 'customer' && hosts.length > 0 && (
            <div className="px-3 mt-3">
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 mb-1">
                Geteilte Betriebe
              </p>
              <ul className="space-y-1">
                {hosts.map((host) => {
                  const hostHref = `/app/datasets?hostId=${host.hostUserId}`;
                  const isActive = hostId === host.hostUserId;
                  return (
                    <li key={host.hostUserId}>
                      <Link href={hostHref}>
                        <div
                          onClick={() => setMobileDrawerOpen(false)}
                          className={cn(
                            "flex items-center gap-3 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer min-h-[48px]",
                            isActive
                              ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          )}
                        >
                          <Users className="w-5 h-5 shrink-0" />
                          <span className="truncate">{host.hostName}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>

        <hr className="border-border/40 mx-3" />

        {/* Legal footer links */}
        <div className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1">
          <Link href="/impressum" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Impressum</Link>
          <Link href="/agb" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">AGB</Link>
          <Link href="/datenschutz" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Datenschutz</Link>
        </div>

        {/* User section */}
        <div className="p-3">
          <div className="flex items-center rounded-lg bg-secondary/50 p-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-primary font-bold shrink-0 text-sm">
              {user?.firstName?.charAt(0) || user?.emailAddresses[0]?.emailAddress?.charAt(0) || "U"}
            </div>
            <div className="flex-1 min-w-0 ml-3">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.firstName || "Benutzer"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.emailAddresses[0]?.emailAddress}
              </p>
            </div>
          </div>
          <button 
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            className="mt-2 w-full flex items-center gap-3 px-3 min-h-[44px] text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Abmelden
          </button>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background min-w-0">
        <DatasetAwareHeader
          viewMode={viewMode}
          navItems={navItems}
          currentPath={currentPath}
          datasetId={datasetId}
          onOpenMobileMenu={() => setMobileDrawerOpen(true)}
        />
        <div
          className={cn(
            "flex-1 relative min-h-0",
            isFullHeightPage
              ? "overflow-hidden"
              : "overflow-y-auto p-4 md:p-8"
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
