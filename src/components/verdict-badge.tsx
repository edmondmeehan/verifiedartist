import { VERDICT_META, type Verdict } from "@/lib/verdict";

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return <span className={meta.className}>{meta.label}</span>;
}
