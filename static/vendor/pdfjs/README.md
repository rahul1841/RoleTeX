# PDF.js (vendored)

`pdf.min.mjs` and `pdf.worker.min.mjs` from PDF.js **4.6.82**, taken verbatim
from `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/`.

Vendored rather than loaded from a CDN so the editor's preview keeps working
with no network, matching the rest of the app (Tectonic compiles from a warm
local bundle). Licensed Apache-2.0 by Mozilla; the notice is retained at the
top of each file.

To upgrade, replace both files with the same version of each and reload — the
only API used is `getDocument`, `GlobalWorkerOptions.workerSrc`, and
`page.render`, which have been stable across 3.x and 4.x.
