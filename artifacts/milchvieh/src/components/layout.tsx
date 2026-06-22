import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { useUser, useClerk } from "@clerk/react";
import { useGetDataset } from "@workspace/api-client-react";
import { 
  Home, 
  BarChart2, 
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
} from "lucide-react";

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
}: {
  viewMode: 'customer' | 'operator';
  navItems: { name: string; href: string }[];
  currentPath: string;
  datasetId: string | null;
}) {
  const { data: dataset } = useGetDataset(datasetId!, {
    query: { enabled: !!datasetId && viewMode === 'customer' },
  });

  const sectorMeta = dataset ? (SECTOR_META[(dataset as any).sector ?? "dairy"] ?? SECTOR_META.dairy) : null;

  return (
    <header className="h-16 border-b bg-card/95 backdrop-blur-sm flex items-center px-6 shrink-0 gap-3">
      <div className="flex items-center text-sm text-muted-foreground">
        {viewMode === 'operator' ? 'Operator Dashboard' : 'Datenanalyse'}
        <ChevronRight className="w-4 h-4 mx-2" />
        <span className="text-foreground font-medium">
          {navItems.find(i => currentPath.startsWith(i.href))?.name || "App"}
        </span>
      </div>
      {sectorMeta && (
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">
          <sectorMeta.icon className="w-3.5 h-3.5" />
          {sectorMeta.label}
        </span>
      )}
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

  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    return localStorage.getItem("navCollapsed") !== "false";
  });

  function toggleNav() {
    setNavCollapsed((prev) => {
      localStorage.setItem("navCollapsed", String(!prev));
      return !prev;
    });
  }

  const search = useSearch(); // reactive to query-string changes
  const datasetId = new URLSearchParams(search).get("datasetId");
  const datasetQuery = datasetId ? `?datasetId=${datasetId}` : "";

  const currentPath = location.startsWith(basePath) 
    ? location.slice(basePath.length) || "/" 
    : location;

  const isFullHeightPage = currentPath.startsWith('/app/analyses');

  const customerNav = [
    { name: "Betriebe", href: "/app/datasets", icon: Home, preserveDataset: false },
    { name: "Analysen", href: "/app/analyses", icon: MessageSquare, preserveDataset: true },
    { name: "Übersicht", href: "/app/overview", icon: BarChart2, preserveDataset: true },
    { name: "Dateien & Upload", href: "/app/upload", icon: Upload, preserveDataset: true },
    { name: "Warnungen", href: "/app/warnings", icon: AlertTriangle, preserveDataset: true },
    { name: "Berichte", href: "/app/reports", icon: FileText, preserveDataset: true },
    { name: "Regeln", href: "/app/rules", icon: Sliders, preserveDataset: true },
    { name: "Einstellungen", href: "/app/settings", icon: Settings, preserveDataset: false },
  ];

  const operatorNav = [
    { name: "Monitoring", href: "/app/monitoring", icon: Activity, preserveDataset: false },
    { name: "Stammdaten", href: "/app/master-data", icon: Database, preserveDataset: false },
    { name: "Wissensbibliothek", href: "/app/knowledge", icon: BookOpen, preserveDataset: false },
    { name: "Auswertungsvorlagen", href: "/app/templates", icon: LayoutList, preserveDataset: false },
  ];

  const navItems = viewMode === 'operator' ? operatorNav : customerNav;

  const handleSwitchView = () => {
    if (!onSwitchView) return;
    const next = viewMode === 'operator' ? 'customer' : 'operator';
    onSwitchView(next);
    setLocation(next === 'operator' ? '/app/monitoring' : '/app/analyses');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "border-r bg-card flex flex-col transition-all duration-200 shrink-0",
          navCollapsed ? "w-12" : "w-56"
        )}
      >
        {/* Header / logo + toggle */}
        <div className="h-16 flex items-center border-b shrink-0 px-2 gap-1">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8 shrink-0" />
          {!navCollapsed && (
            <span className="font-bold text-primary truncate ml-1 flex-1 text-sm">
              Milchvieh Assistent
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
          <ul className="space-y-0.5 px-2">
            {navItems.map((item) => {
              const isActive = currentPath.startsWith(item.href);
              const Icon = item.icon;
              const href = item.preserveDataset ? `${item.href}${datasetQuery}` : item.href;
              return (
                <li key={item.name}>
                  <Link href={href}>
                    <div
                      title={navCollapsed ? item.name : undefined}
                      className={cn(
                        "flex items-center rounded-md text-sm font-medium transition-colors cursor-pointer",
                        navCollapsed ? "px-2 py-2 justify-center" : "px-3 py-2",
                        isActive 
                          ? "border-l-2 border-primary bg-primary/8 text-primary" 
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <Icon className={cn("w-4 h-4 shrink-0", !navCollapsed && "mr-3")} />
                      {!navCollapsed && item.name}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <hr className="my-0 border-border/40 mx-2" />
        
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

      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background min-w-0">
        <DatasetAwareHeader
          viewMode={viewMode}
          navItems={navItems}
          currentPath={currentPath}
          datasetId={datasetId}
        />
        <div
          className={cn(
            "flex-1 relative min-h-0",
            isFullHeightPage
              ? "overflow-hidden"
              : "overflow-y-auto p-8"
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
