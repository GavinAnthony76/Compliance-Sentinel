import { X, Download, Share } from "lucide-react";
import { usePWAInstall } from "@/hooks/use-pwa";
import { Button } from "@/components/ui";

export function PWAInstallPrompt() {
  const { canInstall, isIOS, promptInstall, dismiss } = usePWAInstall();

  if (!canInstall && !isIOS) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 max-w-sm mx-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm">Install GreenSynk</p>
            {isIOS ? (
              <p className="text-xs text-gray-500 mt-1">
                Tap <Share className="w-3 h-3 inline mx-0.5" /> Share, then <strong>"Add to Home Screen"</strong> to install.
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">
                Add GreenSynk to your home screen for quick access to today's jobs.
              </p>
            )}
          </div>
          <button onClick={dismiss} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!isIOS && (
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={promptInstall} className="flex-1">
              Install App
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
