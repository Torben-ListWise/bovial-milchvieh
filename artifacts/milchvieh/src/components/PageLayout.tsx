import { cn } from "@/lib/utils";

type PageLayoutSize = "narrow" | "standard" | "wide";

const sizeClasses: Record<PageLayoutSize, string> = {
  narrow: "max-w-4xl",
  standard: "max-w-5xl",
  wide: "max-w-7xl",
};

interface PageLayoutProps {
  size?: PageLayoutSize;
  children: React.ReactNode;
  className?: string;
}

export function PageLayout({ size = "standard", children, className }: PageLayoutProps) {
  return (
    <div className={cn("space-y-6 mx-auto", sizeClasses[size], className)}>
      {children}
    </div>
  );
}
