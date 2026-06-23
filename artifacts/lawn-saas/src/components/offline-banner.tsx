import { WifiOff } from "lucide-react";
import { useOfflineStatus } from "@/hooks/use-pwa";

export function OfflineBanner() {
  const isOffline = useOfflineStatus();
  if (!isOffline) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-medium py-2 px-4">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>You're offline. Some features may not be available.</span>
    </div>
  );
}
