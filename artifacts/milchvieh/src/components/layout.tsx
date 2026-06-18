import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useUser, useClerk } from "@clerk/react";
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
  ArrowLeftRight
} from "lucide-react";

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

  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");
  const datasetQuery = datasetId ? `?datasetId=${datasetId}` : "";

  const currentPath = location.startsWith(basePath) 
    ? location.slice(basePath.length) || "/" 
    : location;

  const customerNav = [
    { name: "Betriebe", href: "/app/datasets", icon: Home, preserveDataset: false },
    { name: "Übersicht", href: "/app/overview", icon: BarChart2, preserveDataset: true },
    { name: "Dateien & Upload", href: "/app/upload", icon: Upload, preserveDataset: true },
    { name: "Analysen", href: "/app/analyses", icon: MessageSquare, preserveDataset: true },
    { name: "Warnungen", href: "/app/warnings", icon: AlertTriangle, preserveDataset: true },
    { name: "Berichte", href: "/app/reports", icon: FileText, preserveDataset: true },
    { name: "Regeln", href: "/app/rules", icon: Sliders, preserveDataset: true },
    { name: "Einstellungen", href: "/app/settings", icon: Settings, preserveDataset: false },
  ];

  const operatorNav = [
    { name: "Monitoring", href: "/app/monitoring", icon: Activity, preserveDataset: false },
    { name: "Stammdaten", href: "/app/master-data", icon: Database, preserveDataset: false },
  ];

  const navItems = viewMode === 'operator' ? operatorNav : customerNav;

  const handleSwitchView = () => {
    if (!onSwitchView) return;
    const next = viewMode === 'operator' ? 'customer' : 'operator';
    onSwitchView(next);
    setLocation(next === 'operator' ? '/app/monitoring' : '/app/datasets');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8 mr-3" />
          <span className="font-bold text-primary truncate">Milchvieh Assistent</span>
        </div>

        {/* View toggle for operators */}
        {role === 'operator' && onSwitchView && (
          <div className="px-3 pt-3">
            <button
              onClick={handleSwitchView}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium bg-primary/5 border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
              {viewMode === 'operator' ? 'Zur Kunden-Ansicht wechseln' : 'Zur Operator-Ansicht wechseln'}
            </button>
          </div>
        )}
        
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const isActive = currentPath.startsWith(item.href);
              const Icon = item.icon;
              const href = item.preserveDataset ? `${item.href}${datasetQuery}` : item.href;
              return (
                <li key={item.name}>
                  <Link href={href}>
                    <div className={cn(
                      "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                      isActive 
                        ? "bg-primary/10 text-primary" 
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}>
                      <Icon className="w-4 h-4 mr-3" />
                      {item.name}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        
        <div className="p-4 border-t">
          <div className="flex items-center p-3 rounded-md bg-secondary/50">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold mr-3 shrink-0">
              {user?.firstName?.charAt(0) || user?.emailAddresses[0]?.emailAddress?.charAt(0) || "U"}
            </div>
            <div className="flex-1 min-w-0">
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
            className="mt-2 w-full flex items-center px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3" />
            Abmelden
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background">
        <header className="h-16 border-b bg-card flex items-center px-8 shrink-0">
          <div className="flex items-center text-sm text-muted-foreground">
            {viewMode === 'operator' ? 'Operator Dashboard' : 'Milchvieh Datenanalyse'}
            <ChevronRight className="w-4 h-4 mx-2" />
            <span className="text-foreground font-medium">
              {navItems.find(i => currentPath.startsWith(i.href))?.name || "App"}
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 relative">
          {children}
        </div>
      </main>
    </div>
  );
}
