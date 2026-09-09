/**
 * PDF rendering and delivery.
 *
 * Shared on purpose: the resumes builder, the tailor workspace and the run
 * history all show a compiled PDF that arrived as base64 inside JSON, and all
 * three need the same viewer, the same download path and the same object-URL
 * discipline. Import from `@/components/pdf`.
 */
export { PdfViewerPanel } from "./pdf-viewer-lazy";
export { PdfViewer, type PdfViewerProps } from "./pdf-viewer";
export { PdfPageCanvas, type PdfPageCanvasProps } from "./pdf-page";
export {
  usePdfDocument,
  usePdfPageSize,
  type PdfDocumentState,
} from "./use-pdf-document";
export {
  loadPdfjs,
  isRenderCancelled,
  copyBytes,
  type Pdfjs,
  type PdfDocument,
  type PdfPage,
} from "./pdfjs";
export {
  base64ToBytes,
  base64ToPdfBlob,
  createObjectUrl,
  downloadBase64Pdf,
  downloadBlob,
  liveObjectUrlCount,
  revokeAllObjectUrls,
  revokeObjectUrl,
  sanitizeFilename,
} from "./blob-url";
