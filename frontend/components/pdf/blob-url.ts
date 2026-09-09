/**
 * Object-URL lifecycle, base64 decoding, and file downloads.
 *
 * Every compiled PDF in this app arrives as base64 inside a JSON body — the
 * preview endpoint, the tailor endpoint and the run re-compile endpoint all
 * return `pdf_base64`, never a binary response. So every download has to
 * decode, wrap in a Blob, and hand the browser an object URL.
 *
 * An object URL pins its Blob in memory until it is revoked. In a live-preview
 * loop that recompiles on every editing pause that is not a theoretical leak:
 * a few hundred kilobytes per compile, held forever. The registry below is the
 * one place URLs are minted, so `revokeAllObjectUrls()` can sweep whatever a
 * component forgot, and a single `pagehide` listener catches the rest.
 *
 * `pagehide` rather than `beforeunload`: `beforeunload` is skipped when a page
 * enters the back/forward cache, and registering one makes the page ineligible
 * for that cache in some browsers. `pagehide` fires in both cases.
 */

/** Every URL this module has minted and not yet revoked. */
const liveUrls = new Set<string>();

let sweeperInstalled = false;

function installSweeper(): void {
  if (sweeperInstalled || typeof window === "undefined") return;
  sweeperInstalled = true;
  window.addEventListener("pagehide", revokeAllObjectUrls);
}

/** `URL.createObjectURL`, tracked so it can always be reclaimed. */
export function createObjectUrl(blob: Blob): string {
  installSweeper();
  const url = URL.createObjectURL(blob);
  liveUrls.add(url);
  return url;
}

/** Revoke one URL. Safe to call twice, and safe on a URL we did not mint. */
export function revokeObjectUrl(url: string | null | undefined): void {
  if (!url) return;
  liveUrls.delete(url);
  URL.revokeObjectURL(url);
}

/** Release everything still outstanding. Called on page hide. */
export function revokeAllObjectUrls(): void {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

/** How many URLs are currently held. Exported for leak debugging. */
export function liveObjectUrlCount(): number {
  return liveUrls.size;
}

/**
 * Decode a base64 PDF payload into bytes.
 *
 * `atob` yields a binary string, copied byte-by-byte rather than through
 * `Uint8Array.from(str, (c) => c.charCodeAt(0))` — the latter allocates an
 * intermediate array of numbers for a payload that is routinely a megabyte.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64ToPdfBlob(base64: string): Blob {
  const bytes = base64ToBytes(base64);
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Characters that must never reach a `download` attribute. */
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f<>:"\/\\|?*]+/g;

/**
 * Make a filename safe to hand to a download.
 *
 * The server already derives a slug for `ResumePreviewResponse.filename`, but
 * this app also builds names from user-controlled text (a resume's name, a
 * version number), and a name carrying `/`, `\` or a leading dot can land the
 * file somewhere the user did not intend, or hide it entirely.
 */
export function sanitizeFilename(name: string, extension = "pdf"): string {
  const suffix = `.${extension}`;
  const stem = name.toLowerCase().endsWith(suffix)
    ? name.slice(0, -suffix.length)
    : name;

  const cleaned = stem
    .replace(UNSAFE_FILENAME, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);

  return `${cleaned || "resume"}${suffix}`;
}

/**
 * Save a Blob to the user's disk.
 *
 * The anchor has to be in the document for Firefox to honour the click, and
 * the URL is revoked on a later task rather than immediately: some browsers
 * read the URL asynchronously after the click returns, and revoking
 * synchronously produces a silently empty file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = createObjectUrl(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => revokeObjectUrl(url), 10_000);
}

/** The whole download path for a base64 PDF, in one call. */
export function downloadBase64Pdf(base64: string, filename: string): void {
  downloadBlob(base64ToPdfBlob(base64), sanitizeFilename(filename));
}
