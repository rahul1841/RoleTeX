"use client";

import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorState, TextSkeleton } from "@/components/common";
import type { JdDetail } from "@/lib/api/types";
import { useJdVersions } from "@/hooks/use-jds";
import { describeJdFailure } from "./errors";
import { formatAbsolute, formatRelative, serverExcerpt } from "./format";
import { formatNumber } from "./limits";

/**
 * The archive trail behind one job description.
 *
 * `PUT /api/jds/{id}` never overwrites: it copies the current revision into a
 * versions collection, bumps `version`, and prunes the oldest archived rows
 * past the server's per-JD cap. This renders that trail, newest first, with the
 * live revision at the top so the sequence reads as one history rather than
 * "the current one" and "some other list".
 *
 * TWO THINGS THIS SCREEN HAS TO BE HONEST ABOUT, both verified against the
 * running server:
 *
 *  1. `GET /api/jds/{id}/versions` returns `{version, title, excerpt,
 *     created_at}` and NOTHING ELSE. The archived body is stored but is not
 *     exposed, so an old revision genuinely cannot be read in full or restored
 *     from here, and the UI must not imply otherwise with a "view" or "revert"
 *     affordance it cannot honour.
 *  2. An archived entry's `created_at` is the moment it was REPLACED, not the
 *     moment it was written — app/db.py stamps `now` as it archives. Labelling
 *     it "created" would be off by exactly one edit, so it is labelled
 *     "replaced".
 *
 * Pruning is detectable rather than guessed: the newest version number tells us
 * how many revisions have existed, so `version - 1` greater than the number of
 * archived rows means the server has dropped the difference.
 */
export function JdVersionHistory({ jd }: { jd: JdDetail }) {
  const versions = useJdVersions(jd.id);

  if (versions.isPending) {
    return <TextSkeleton lines={4} className="py-2" />;
  }

  if (versions.isError) {
    const copy = describeJdFailure(versions.error, "Could not load the version history");
    return (
      <ErrorState
        error={versions.error}
        title={copy.title}
        variant="bare"
        onRetry={copy.retryable ? () => void versions.refetch() : undefined}
      />
    );
  }

  const archived = versions.data ?? [];
  const expected = Math.max(0, jd.version - 1);
  const pruned = Math.max(0, expected - archived.length);

  return (
    <div className="space-y-4">
      <ol className="border-border relative space-y-5 border-l pl-5">
        <VersionEntry
          current
          version={jd.version}
          title={jd.title}
          excerpt={serverExcerpt(jd.content)}
          timestampLabel="Updated"
          timestamp={jd.updated_at}
        />
        {archived.map((entry) => (
          <VersionEntry
            key={entry.version}
            version={entry.version}
            title={entry.title}
            excerpt={entry.excerpt}
            timestampLabel="Replaced"
            timestamp={entry.created_at}
          />
        ))}
      </ol>

      {archived.length === 0 ? (
        <p className="text-muted-foreground text-xs text-pretty">
          This is the original. Editing it will archive this revision as version{" "}
          {jd.version} and start version {jd.version + 1}.
        </p>
      ) : (
        <p className="text-muted-foreground flex gap-2 text-xs text-pretty">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Archived revisions are stored, but this API returns only the first
            160 characters of each — they cannot be read in full or restored
            from here. Copy the current text before you replace it if you need
            to keep it.
          </span>
        </p>
      )}

      {pruned > 0 ? (
        <p className="border-warning-border bg-warning text-warning-foreground rounded-md border px-2.5 py-1.5 text-xs text-pretty">
          {formatNumber(pruned)} older{" "}
          {pruned === 1 ? "revision has" : "revisions have"} been discarded. This
          server keeps only the most recent {formatNumber(archived.length)}{" "}
          snapshots of a job description, and each edit drops the oldest.
        </p>
      ) : null}
    </div>
  );
}

function VersionEntry({
  version,
  title,
  excerpt,
  timestamp,
  timestampLabel,
  current = false,
}: {
  version: number;
  title: string;
  excerpt: string;
  timestamp: string | null | undefined;
  timestampLabel: string;
  current?: boolean;
}) {
  return (
    <li className="relative">
      {/* The ring punches a hole in the timeline rule so the marker reads as a
          node on it rather than a dot floating over it. */}
      <span
        aria-hidden="true"
        className={cn(
          "ring-card absolute top-1.5 -left-6 size-2 rounded-full ring-4",
          current ? "bg-primary" : "bg-border",
        )}
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={current ? "secondary" : "outline"} className="font-mono">
          v{version}
        </Badge>
        {current ? (
          <span className="text-foreground text-xs font-medium">Current</span>
        ) : null}
        <span
          className="text-muted-foreground text-xs"
          title={formatAbsolute(timestamp)}
        >
          {timestampLabel} {formatRelative(timestamp)}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-snug font-medium text-pretty">{title}</p>
      {excerpt ? (
        <p className="bg-code text-code-foreground border-code-border mt-1.5 rounded-md border px-2.5 py-2 font-mono text-xs leading-relaxed break-words">
          {excerpt}
          {excerpt.length >= 160 ? <span className="opacity-50">…</span> : null}
        </p>
      ) : null}
    </li>
  );
}
