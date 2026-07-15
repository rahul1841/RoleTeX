(() => {
  "use strict";

  const API_ENDPOINT = "/api/tailor";
  const IMPORT_ENDPOINT = "/api/import";
  const REQUEST_TIMEOUT_MS = 180_000;
  const RESUME_ID_KEY = "jd_resume_id";
  const RESUME_NAME_KEY = "jd_resume_name";

  const importForm = document.getElementById("import-form");
  const latexInput = document.getElementById("latex-input");
  const latexCount = document.getElementById("latex-count");
  const importButton = document.getElementById("import-button");
  const importLabel = importButton.querySelector(".button-label");
  const importError = document.getElementById("import-error");
  const importErrorMessage = document.getElementById("import-error-message");
  const profileStatusText = document.getElementById("profile-status-text");
  const clearProfileButton = document.getElementById("clear-profile-button");

  const form = document.getElementById("tailor-form");
  const jobDescription = document.getElementById("job-description");
  const characterCount = document.getElementById("character-count");
  const submitButton = document.getElementById("submit-button");
  const submitLabel = submitButton.querySelector(".button-label");
  const resetButton = document.getElementById("reset-button");
  const startOverButton = document.getElementById("start-over-button");
  const errorPanel = document.getElementById("error-panel");
  const errorMessage = document.getElementById("error-message");
  const loadingPanel = document.getElementById("loading-panel");
  const loadingMessage = document.getElementById("loading-message");
  const results = document.getElementById("results");
  const providerMeta = document.getElementById("provider-meta");
  const pageMeta = document.getElementById("page-meta");
  const warningsPanel = document.getElementById("warnings-panel");
  const warningsList = document.getElementById("warnings-list");
  const changeCount = document.getElementById("change-count");
  const changesList = document.getElementById("changes-list");
  const pdfPreview = document.getElementById("pdf-preview");
  const previewEmpty = document.getElementById("preview-empty");
  const previewFilename = document.getElementById("preview-filename");
  const pdfDownload = document.getElementById("pdf-download");
  const texDownload = document.getElementById("tex-download");

  const maximumCharacters = Number(jobDescription.maxLength) || 20_000;
  const minimumCharacters = Number(jobDescription.minLength) || 50;
  const numberFormat = new Intl.NumberFormat();
  const progressMessages = [
    "Reading the role and your experience…",
    "Refining the editable resume fields…",
    "Validating every suggested change…",
    "Compiling your protected LaTeX template…",
    "Running final PDF checks…",
  ];

  const state = {
    requestVersion: 0,
    controller: null,
    progressTimer: null,
    pdfUrl: null,
    texUrl: null,
  };

  class ApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  function updateCharacterCount() {
    const length = jobDescription.value.length;
    characterCount.textContent = `${numberFormat.format(length)} / ${numberFormat.format(maximumCharacters)}`;
    characterCount.classList.toggle("is-near-limit", length >= maximumCharacters * 0.9);
  }

  const maximumLatex = Number(latexInput.maxLength) || 200_000;
  const minimumLatex = Number(latexInput.minLength) || 40;

  function getStored(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  }

  function setStored(key, value) {
    try {
      if (value) {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (_error) {
      /* Storage may be unavailable (private mode); the id simply won't persist. */
    }
  }

  function updateLatexCount() {
    const length = latexInput.value.length;
    latexCount.textContent = `${numberFormat.format(length)} / ${numberFormat.format(maximumLatex)}`;
    latexCount.classList.toggle("is-near-limit", length >= maximumLatex * 0.9);
  }

  function updateProfileStatus() {
    const resumeId = getStored(RESUME_ID_KEY);
    const name = getStored(RESUME_NAME_KEY);
    if (resumeId) {
      profileStatusText.textContent = name
        ? `Tailoring ${name}’s imported resume.`
        : "Tailoring your imported resume.";
      clearProfileButton.hidden = false;
    } else {
      profileStatusText.textContent = "No resume imported yet — the sample resume will be used.";
      clearProfileButton.hidden = true;
    }
  }

  function clearImportError() {
    importError.hidden = true;
    importErrorMessage.textContent = "";
  }

  function showImportError(message) {
    importErrorMessage.textContent = message;
    importError.hidden = false;
    importError.focus({ preventScroll: true });
    importError.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }

  function setImporting(isImporting) {
    importButton.disabled = isImporting;
    latexInput.disabled = isImporting;
    importForm.setAttribute("aria-busy", String(isImporting));
    importForm.classList.toggle("is-loading", isImporting);
    importLabel.textContent = isImporting ? "Importing…" : "Import resume";
  }

  async function handleImport(event) {
    event.preventDefault();
    clearImportError();

    const latex = latexInput.value.trim();
    if (latex.length < minimumLatex) {
      showImportError(`Paste your resume LaTeX first — at least ${minimumLatex} characters.`);
      latexInput.focus();
      return;
    }
    if (latex.length > maximumLatex) {
      showImportError(`That LaTeX is too long. Trim it to ${numberFormat.format(maximumLatex)} characters or fewer.`);
      return;
    }

    const controller = new AbortController();
    let didTimeOut = false;
    const timeout = window.setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setImporting(true);

    try {
      const response = await fetch(IMPORT_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ latex }),
        signal: controller.signal,
      });
      const payload = await parseResponse(response);
      if (!response.ok) {
        throw new ApiError(errorFromPayload(payload, response.status), response.status);
      }

      const id = readableValue(payload.id).trim();
      if (!id) {
        throw new ApiError("The import did not return a profile id. Please try again.");
      }
      const name = payload.resume && payload.resume.identity
        ? readableValue(payload.resume.identity.name).trim()
        : "";
      setStored(RESUME_ID_KEY, id);
      setStored(RESUME_NAME_KEY, name);
      updateProfileStatus();
      profileStatusText.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      jobDescription.focus({ preventScroll: true });
    } catch (error) {
      if (didTimeOut) {
        showImportError("The import took longer than three minutes. The server may be waking up—please try once more.");
      } else if (error instanceof ApiError) {
        showImportError(error.message);
      } else if (error && error.name === "AbortError") {
        /* Superseded or navigated away; ignore. */
      } else {
        showImportError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      setImporting(false);
    }
  }

  function clearProfile() {
    setStored(RESUME_ID_KEY, "");
    setStored(RESUME_NAME_KEY, "");
    updateProfileStatus();
  }

  async function verifyStoredProfile() {
    const resumeId = getStored(RESUME_ID_KEY);
    if (!resumeId) {
      return;
    }
    try {
      const response = await fetch(`/api/resume/${encodeURIComponent(resumeId)}`, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) {
        // The profile is gone (e.g. ephemeral disk was reset). Fall back cleanly.
        clearProfile();
        return;
      }
      if (response.ok) {
        const payload = await response.json();
        const name = payload && payload.resume && payload.resume.identity
          ? readableValue(payload.resume.identity.name).trim()
          : "";
        setStored(RESUME_NAME_KEY, name);
        updateProfileStatus();
      }
    } catch (_error) {
      /* Offline or transient; keep the stored id and let tailoring surface issues. */
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function clearError() {
    errorPanel.hidden = true;
    errorMessage.textContent = "";
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorPanel.hidden = false;
    errorPanel.focus({ preventScroll: true });
    errorPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function startProgressMessages() {
    stopProgressMessages();
    let index = 0;
    loadingMessage.textContent = progressMessages[index];
    state.progressTimer = window.setInterval(() => {
      index = Math.min(index + 1, progressMessages.length - 1);
      loadingMessage.textContent = progressMessages[index];
      if (index === progressMessages.length - 1) {
        stopProgressMessages();
      }
    }, 5_000);
  }

  function stopProgressMessages() {
    if (state.progressTimer !== null) {
      window.clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }

  function setLoading(isLoading) {
    form.classList.toggle("is-loading", isLoading);
    form.setAttribute("aria-busy", String(isLoading));
    submitButton.disabled = isLoading;
    jobDescription.disabled = isLoading;
    submitLabel.textContent = isLoading ? "Tailoring…" : "Tailor my resume";
    loadingPanel.hidden = !isLoading;

    if (isLoading) {
      startProgressMessages();
      window.requestAnimationFrame(() => {
        loadingPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      stopProgressMessages();
    }
  }

  function revokeObjectUrl(key) {
    if (state[key]) {
      URL.revokeObjectURL(state[key]);
      state[key] = null;
    }
  }

  function clearGeneratedFiles() {
    pdfPreview.removeAttribute("src");
    revokeObjectUrl("pdfUrl");
    revokeObjectUrl("texUrl");
    pdfDownload.removeAttribute("href");
    texDownload.removeAttribute("href");
  }

  function resetWorkspace({ focus = true } = {}) {
    state.requestVersion += 1;
    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }

    setLoading(false);
    clearError();
    clearGeneratedFiles();
    results.hidden = true;
    jobDescription.disabled = false;
    jobDescription.value = "";
    updateCharacterCount();

    if (focus) {
      document.querySelector(".composer-card").scrollIntoView({ behavior: "smooth", block: "start" });
      jobDescription.focus({ preventScroll: true });
    }
  }

  function readableValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (Array.isArray(value)) {
      return value.map((item) => readableValue(item)).filter(Boolean).join(", ");
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch (_error) {
        return String(value);
      }
    }
    return String(value);
  }

  function humanizeFieldId(value, fallback) {
    const fieldId = readableValue(value).trim() || fallback;
    return fieldId
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_.:/-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function normalizeChanges(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const id = item.field_id ?? item.id ?? item.field;
        const field = item.field && item.id && item.field !== item.id
          ? `${readableValue(item.field)} · ${readableValue(item.id)}`
          : id;
        return {
          label: humanizeFieldId(field, `Change ${index + 1}`),
          before: readableValue(item.before),
          after: readableValue(item.after),
        };
      });
  }

  function normalizeWarnings(...values) {
    const warnings = [];
    values.forEach((value) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((warning) => {
        const text = typeof warning === "object" && warning !== null
          ? readableValue(warning.message ?? warning.detail ?? warning)
          : readableValue(warning);
        const trimmed = text.trim();
        if (trimmed && !warnings.includes(trimmed)) {
          warnings.push(trimmed);
        }
      });
    });
    return warnings;
  }

  function sanitizeFilename(value, fallback = "tailored-resume.pdf") {
    const basename = readableValue(value)
      .split(/[\\/]/)
      .pop()
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[<>:"|?*]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 120);
    const safeName = basename || fallback;
    return /\.pdf$/i.test(safeName) ? safeName : `${safeName.replace(/\.[^.]+$/, "")}.pdf`;
  }

  function normalizeResponse(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError("The server returned an unexpected response. Please try again.");
    }

    const compiler = payload.compiler && typeof payload.compiler === "object"
      ? payload.compiler
      : {};
    const filename = sanitizeFilename(payload.filename);
    let pdfBase64 = readableValue(payload.pdf_base64).trim();

    if (!pdfBase64 && typeof payload.pdf_data_url === "string") {
      pdfBase64 = payload.pdf_data_url.trim();
    }

    return {
      provider: readableValue(payload.provider).trim(),
      model: readableValue(payload.model).trim(),
      changes: normalizeChanges(payload.changes),
      warnings: normalizeWarnings(payload.warnings, compiler.warnings),
      latexSource: readableValue(payload.latex_source),
      pdfBase64,
      pageCount: payload.page_count ?? compiler.page_count ?? null,
      filename,
    };
  }

  function base64ToPdfBlob(value) {
    const commaIndex = value.indexOf(",");
    const encoded = value.startsWith("data:") && commaIndex >= 0
      ? value.slice(commaIndex + 1)
      : value;
    const clean = encoded.replace(/\s/g, "");

    if (!clean) {
      return null;
    }

    let binary;
    try {
      binary = window.atob(clean);
    } catch (_error) {
      throw new ApiError("The compiled PDF was returned in an invalid format. Please try again.");
    }

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "application/pdf" });
  }

  function appendChangeBlock(card, kind, text) {
    const block = document.createElement("div");
    block.className = `change-block change-block--${kind}`;

    const label = document.createElement("span");
    label.className = "change-label";
    label.textContent = kind === "before" ? "Original" : "Tailored";

    const content = document.createElement(kind === "before" ? "del" : "ins");
    content.className = "change-text";
    content.textContent = text || (kind === "before" ? "No previous content" : "Content removed");
    content.classList.toggle("is-empty", !text);

    block.append(label, content);
    card.append(block);
  }

  function renderChanges(changes) {
    changesList.replaceChildren();
    changeCount.textContent = `${changes.length} ${changes.length === 1 ? "change" : "changes"}`;

    if (changes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "changes-empty";
      const title = document.createElement("strong");
      title.textContent = "No wording changes returned";
      const description = document.createElement("span");
      description.textContent = "The generated resume may already match the original content.";
      empty.append(title, description);
      changesList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    changes.forEach((change) => {
      const card = document.createElement("article");
      card.className = "change-card";

      const title = document.createElement("h4");
      title.className = "change-title";
      title.textContent = change.label;
      card.append(title);
      appendChangeBlock(card, "before", change.before);

      const connector = document.createElement("span");
      connector.className = "change-connector";
      connector.setAttribute("aria-hidden", "true");
      connector.textContent = "↓";
      card.append(connector);

      appendChangeBlock(card, "after", change.after);
      fragment.append(card);
    });
    changesList.append(fragment);
  }

  function renderWarnings(warnings) {
    warningsList.replaceChildren();
    warningsPanel.hidden = warnings.length === 0;
    if (warnings.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    warnings.forEach((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      fragment.append(item);
    });
    warningsList.append(fragment);
  }

  function renderDownloads(data) {
    clearGeneratedFiles();
    previewFilename.textContent = data.filename;
    pdfDownload.download = data.filename;

    const pdfBlob = data.pdfBase64 ? base64ToPdfBlob(data.pdfBase64) : null;
    if (pdfBlob) {
      state.pdfUrl = URL.createObjectURL(pdfBlob);
      pdfPreview.src = `${state.pdfUrl}#view=FitH`;
      pdfPreview.hidden = false;
      previewEmpty.hidden = true;
      pdfDownload.href = state.pdfUrl;
      pdfDownload.hidden = false;
    } else {
      pdfPreview.hidden = true;
      previewEmpty.hidden = false;
      pdfDownload.hidden = true;
    }

    if (data.latexSource) {
      const texName = data.filename.replace(/\.pdf$/i, ".tex");
      const texBlob = new Blob([data.latexSource], { type: "text/plain;charset=utf-8" });
      state.texUrl = URL.createObjectURL(texBlob);
      texDownload.href = state.texUrl;
      texDownload.download = texName;
      texDownload.hidden = false;
    } else {
      texDownload.hidden = true;
    }
  }

  function renderResult(data) {
    const providerDetails = [data.provider, data.model].filter(Boolean);
    providerMeta.textContent = providerDetails.length
      ? providerDetails.join(" · ")
      : "Configured AI model";

    const numericPageCount = Number(data.pageCount);
    if (Number.isFinite(numericPageCount) && numericPageCount > 0) {
      pageMeta.textContent = `${numericPageCount} ${numericPageCount === 1 ? "page" : "pages"}`;
    } else {
      pageMeta.textContent = data.pdfBase64 ? "PDF compiled" : "Source generated";
    }

    renderWarnings(data.warnings);
    renderChanges(data.changes);
    renderDownloads(data);
    results.hidden = false;
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        return await response.json();
      } catch (_error) {
        throw new ApiError("The server returned incomplete data. Please try again.", response.status);
      }
    }

    const text = await response.text();
    if (!response.ok) {
      return { detail: text };
    }
    throw new ApiError("The server returned an unsupported response. Please try again.", response.status);
  }

  function errorFromPayload(payload, status) {
    const detail = payload && payload.detail;
    let message = "";

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((item) => readableValue(item && (item.msg ?? item.message ?? item)))
        .filter(Boolean)
        .join(" ");
    } else if (detail && typeof detail === "object") {
      message = readableValue(detail.message ?? detail.detail ?? detail.error);
    }

    if (!message && payload && typeof payload === "object") {
      message = readableValue(payload.message ?? payload.error);
    }

    if (message.trim()) {
      return message.trim();
    }
    if (status === 429) {
      return "The AI provider’s free quota is temporarily exhausted. Wait a moment and try again.";
    }
    if (status === 413) {
      return "That job description is too large. Shorten it and try again.";
    }
    if (status === 422) {
      return "The job description or generated changes could not be validated. Please revise it and try again.";
    }
    if (status >= 500) {
      return "The server could not finish this resume. Please try again in a moment.";
    }
    return "The request could not be completed. Please try again.";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearError();

    const description = jobDescription.value.trim();
    if (!description) {
      showError("Paste a job description before tailoring your resume.");
      jobDescription.focus();
      return;
    }
    if (description.length < minimumCharacters) {
      showError(`Add a little more detail—the job description must be at least ${minimumCharacters} characters.`);
      jobDescription.focus();
      return;
    }
    if (description.length > maximumCharacters) {
      showError(`Shorten the job description to ${numberFormat.format(maximumCharacters)} characters or fewer.`);
      jobDescription.focus();
      return;
    }

    state.requestVersion += 1;
    const currentRequest = state.requestVersion;
    const controller = new AbortController();
    state.controller = controller;
    let didTimeOut = false;
    const timeout = window.setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    results.hidden = true;
    clearGeneratedFiles();
    setLoading(true);

    try {
      const requestBody = { job_description: description };
      const resumeId = getStored(RESUME_ID_KEY);
      if (resumeId) {
        requestBody.resume_id = resumeId;
      }
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const payload = await parseResponse(response);

      if (currentRequest !== state.requestVersion) {
        return;
      }
      if (!response.ok) {
        throw new ApiError(errorFromPayload(payload, response.status), response.status);
      }

      const data = normalizeResponse(payload);
      setLoading(false);
      renderResult(data);
    } catch (error) {
      if (currentRequest !== state.requestVersion) {
        return;
      }
      if (error && error.name === "AbortError" && !didTimeOut) {
        return;
      }

      setLoading(false);
      if (didTimeOut) {
        showError("The request took longer than three minutes. The server may be waking up—please try once more.");
      } else if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === state.requestVersion) {
        if (state.controller === controller) {
          state.controller = null;
        }
        setLoading(false);
      }
    }
  }

  jobDescription.addEventListener("input", updateCharacterCount);
  form.addEventListener("submit", handleSubmit);
  resetButton.addEventListener("click", () => resetWorkspace());
  startOverButton.addEventListener("click", () => resetWorkspace());
  window.addEventListener("beforeunload", clearGeneratedFiles);

  latexInput.addEventListener("input", updateLatexCount);
  importForm.addEventListener("submit", handleImport);
  clearProfileButton.addEventListener("click", clearProfile);

  updateCharacterCount();
  updateLatexCount();
  updateProfileStatus();
  verifyStoredProfile();
})();
