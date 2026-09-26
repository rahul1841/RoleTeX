import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

/**
 * A picture of the provider-keys list in Settings.
 *
 * The hints follow the server's real format — an ellipsis and the key's last
 * four characters (`key_hint` in backend/app/security.py) — because that is the
 * claim the section beside it makes. The keys themselves are invented.
 */
const KEYS = [
  { provider: "Groq", hint: "…4f2a", added: "added 3 days ago", isDefault: true },
  { provider: "Google Gemini", hint: "…9c1e", added: "added last month" },
  { provider: "OpenAI" },
  { provider: "Anthropic" },
] as const satisfies readonly {
  provider: string;
  hint?: string;
  added?: string;
  isDefault?: boolean;
}[];

export function KeysPreview({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="The provider keys list in Settings: saved keys for Groq and Google Gemini, none yet for OpenAI or Anthropic"
      className={cn(
        "bg-card overflow-hidden rounded-2xl shadow-[0_12px_32px_rgb(21_24_31/0.06)] ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex flex-col gap-1 border-b px-5 py-4.5">
        <span className="text-[0.9375rem] font-semibold">Provider keys</span>
        <span className="text-muted-foreground text-[0.8125rem]">
          Stored encrypted. Only the last four characters are ever shown.
        </span>
      </div>
      <ul className="divide-y">
        {KEYS.map((key) => {
          const saved = "hint" in key;
          return (
            <li key={key.provider} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {key.provider}
                  {"isDefault" in key ? (
                    <Badge variant="secondary" className="text-[0.7rem]">
                      Default
                    </Badge>
                  ) : null}
                </span>
                {saved ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    {key.hint} · {key.added}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">No key saved</span>
                )}
              </div>
              <span
                className={cn(
                  buttonVariants({ variant: "outline", size: "xs" }),
                  "pointer-events-none",
                )}
              >
                {saved ? "Replace" : "Add key"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
