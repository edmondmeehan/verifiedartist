import { formatDistanceToNow } from "date-fns";
import { AlertTriangle } from "lucide-react";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

type LastSyncedBadgeProps = {
  syncedAt: string | null;
  className?: string;
  showIcon?: boolean;
};

export function LastSyncedBadge({
  syncedAt,
  className,
  showIcon = true,
}: LastSyncedBadgeProps) {
  const stale = syncedAt
    ? Date.now() - new Date(syncedAt).getTime() > FORTY_EIGHT_HOURS_MS
    : true;
  const label = syncedAt
    ? `Last synced ${formatDistanceToNow(new Date(syncedAt))} ago`
    : "Never synced";
  const title = syncedAt
    ? `Synced at ${new Date(syncedAt).toLocaleString()}`
    : "No Spotify sync recorded";

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
        stale
          ? "border-verdict-stale text-verdict-stale"
          : "border-border text-muted-foreground"
      } ${className ?? ""}`}
    >
      {stale && showIcon && <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}
