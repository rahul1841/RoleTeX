"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common";
import { useHealth } from "@/hooks/use-session";

/**
 * What this deployment actually is.
 *
 * Carried over from the temporary connectivity page that proved the Next ->
 * FastAPI chain during setup. It earns a place in Settings because every
 * question a user asks about unexpected behaviour is answered here: which mode
 * the server is in, which provider and model it will use, and whether a LaTeX
 * compiler exists at all — without one, tailoring produces changes but no PDF.
 *
 * `useHealth` is cached forever (a running server does not change modes), so
 * this is free to render on every visit.
 */
export function ServerStatus() {
  const health = useHealth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server</CardTitle>
        <CardDescription>
          What this RoleTeX deployment is configured with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {health.isPending ? (
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : health.isError ? (
          <ErrorState
            error={health.error}
            onRetry={() => void health.refetch()}
            title="Could not read the server status"
            variant="bare"
          />
        ) : (
          <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-6 gap-y-2.5 text-sm">
            <Row label="Mode">
              <Badge variant={health.data.mode === "demo" ? "outline" : "secondary"}>
                {health.data.mode === "demo" ? "Demo (no database)" : "Multi-user"}
              </Badge>
            </Row>
            <Row label="Status">
              <span className="font-mono">{health.data.status}</span>
            </Row>
            <Row label="Version">
              <span className="font-mono">{health.data.version}</span>
            </Row>
            <Row label="AI provider">
              <span className="font-mono">{health.data.provider}</span>
            </Row>
            <Row label="Model">
              <span className="font-mono break-all">{health.data.model}</span>
            </Row>
            <Row label="LaTeX compiler">
              {health.data.compiler_available ? (
                <span className="text-diff-added-foreground font-medium">
                  Available
                </span>
              ) : (
                <span className="text-destructive font-medium">
                  Unavailable — tailoring will not produce a PDF
                </span>
              )}
            </Row>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
