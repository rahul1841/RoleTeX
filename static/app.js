(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Resume Tailor SPA (no build step, vanilla JS).
   *
   * Security notes:
   * - Every piece of server- or user-provided text is inserted with
   *   textContent / createElement / new Option — never innerHTML.
   * - fetch always uses credentials: "same-origin"; the session cookie
   *   is HttpOnly and never touched by this script.
   * - API keys pass through the Settings form exactly once and are never
   *   stored client-side (no localStorage, no echo from the server).
   * ------------------------------------------------------------------ */

  const REQUEST_TIMEOUT_MS = 180_000;
  const MAX_PDF_BYTES = 10_000_000;
  const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const ROUTES = ["auth", "tailor", "resumes", "jds", "history", "settings"];

  const numberFormat = new Intl.NumberFormat();

  const ERROR_COPY = {
    network_error: "Could not reach the server. Check your connection and try again.",
    not_authenticated: "Please sign in to continue.",
    database_not_configured: "This feature needs the database, which is not configured on this server.",
    email_taken: "An account with this email already exists. Try signing in instead.",
    registration_disabled: "Registration is currently disabled on this server.",
    weak_password: "Passwords must be 8–128 characters long.",
    invalid_credentials: "That email and password combination doesn’t match our records.",
    too_many_attempts: "Too many sign-in attempts. Please wait a few minutes and try again.",
    bad_origin: "The request was blocked for security reasons. Reload the page and try again.",
    rate_limited: "You’re going a little fast — please wait a moment and try again.",
    provider_required: "Choose an AI provider, or set a default in Settings.",
    llm_key_required: "Add an API key for this provider in Settings first.",
    key_decrypt_failed: "Your stored key could not be decrypted. Re-enter it in Settings.",
    unknown_provider: "That provider isn’t supported.",
    key_not_found: "No key is stored for that provider.",
    resume_not_found: "That resume could not be found. It may have been deleted.",
    resume_quota_exceeded: "You’ve reached your resume limit. Delete one to add another.",
    version_quota_exceeded: "This resume has reached its version limit.",
    jd_not_found: "That job description could not be found. It may have been deleted.",
    jd_quota_exceeded: "You’ve reached your saved-JD limit. Delete one to add another.",
    jd_required: "Provide a job description — paste one or pick a saved JD.",
    resume_required: "Pick one of your resumes to tailor.",
    run_not_found: "That history entry could not be found. It may have been deleted.",
    invalid_pdf: "That file doesn’t look like a valid PDF.",
    pdf_too_large: "That PDF is too large — the limit is 10 MB.",
    pdf_no_text: "No selectable text was found in that PDF — it may be scanned images. Try pasting your LaTeX instead.",
    pdf_support_unavailable: "PDF import isn’t available on this server right now. Paste LaTeX instead.",
    pdf_extract_timeout: "Reading that PDF took too long. Try a smaller or simpler file.",
    invalid_llm_proposal: "The AI response did not pass the resume safety checks. Please try again.",
  };

  /* ------------------------------------------------------------- DOM refs */

  const $ = (id) => document.getElementById(id);

  // Chrome
  const appNav = $("app-nav");
  const userChip = $("user-chip");
  const userChipName = $("user-chip-name");
  const logoutButton = $("logout-button");
  const demoBanner = $("demo-banner");
  const bootLoading = $("boot-loading");
  const bootErrorPanel = $("boot-error");
  const bootErrorMessage = $("boot-error-message");
  const bootRetry = $("boot-retry");
  const toastRegion = $("toast-region");

  // Views + focusable titles
  const viewElements = {
    auth: $("view-auth"),
    tailor: $("view-tailor"),
    resumes: $("view-resumes"),
    jds: $("view-jds"),
    history: $("view-history"),
    settings: $("view-settings"),
  };
  const viewTitles = {
    auth: $("auth-title"),
    tailor: $("tailor-title"),
    resumes: $("resumes-title"),
    jds: $("jds-title"),
    history: $("history-title"),
    settings: $("settings-title"),
  };

  // Auth
  const authTabLogin = $("auth-tab-login");
  const authTabRegister = $("auth-tab-register");
  const loginForm = $("login-form");
  const loginEmail = $("login-email");
  const loginPassword = $("login-password");
  const loginError = $("login-error");
  const loginErrorMessage = $("login-error-message");
  const loginButton = $("login-button");
  const registerForm = $("register-form");
  const registerName = $("register-name");
  const registerEmail = $("register-email");
  const registerPassword = $("register-password");
  const registerError = $("register-error");
  const registerErrorMessage = $("register-error-message");
  const registerButton = $("register-button");

  // Tailor
  const tailorForm = $("tailor-form");
  const tailorResumeSelect = $("tailor-resume-select");
  const tailorResumeEmpty = $("tailor-resume-empty");
  const tailorProviderSelect = $("tailor-provider-select");
  const tailorProviderNote = $("tailor-provider-note");
  const tailorModelInput = $("tailor-model-input");
  const tailorLoadError = $("tailor-load-error");
  const tailorLoadErrorMessage = $("tailor-load-error-message");
  const tailorLoadRetry = $("tailor-load-retry");
  const jdTabSaved = $("jd-tab-saved");
  const jdTabPaste = $("jd-tab-paste");
  const jdPanelSaved = $("jd-panel-saved");
  const jdPanelPaste = $("jd-panel-paste");
  const tailorJdSelect = $("tailor-jd-select");
  const tailorJdEmpty = $("tailor-jd-empty");
  const tailorJdPreviewStatus = $("tailor-jd-preview-status");
  const tailorJdPreview = $("tailor-jd-preview");
  const jobDescription = $("job-description");
  const characterCount = $("character-count");
  const saveJdCheckbox = $("save-jd-checkbox");
  const saveJdTitle = $("save-jd-title");
  const compileToggle = $("compile-toggle");
  const onePageToggle = $("one-page-toggle");
  const errorPanel = $("error-panel");
  const errorMessage = $("error-message");
  const resetButton = $("reset-button");
  const submitButton = $("submit-button");
  const loadingPanel = $("loading-panel");
  const loadingMessage = $("loading-message");
  const results = $("results");
  const providerMeta = $("provider-meta");
  const pageMeta = $("page-meta");
  const runChip = $("run-chip");
  const runLink = $("run-link");
  const pdfDownload = $("pdf-download");
  const texDownload = $("tex-download");
  const startOverButton = $("start-over-button");
  const warningsPanel = $("warnings-panel");
  const warningsList = $("warnings-list");
  const changeCount = $("change-count");
  const changesList = $("changes-list");
  const pdfPreview = $("pdf-preview");
  const previewEmpty = $("preview-empty");
  const previewFilename = $("preview-filename");

  // Resumes
  const resumeAddPanel = $("resume-add-panel");
  const resumeAddStep = $("resume-add-step");
  const resumeAddTitle = $("resume-add-title");
  const resumeAddCancel = $("resume-add-cancel");
  const resumeTabLatex = $("resume-tab-latex");
  const resumeTabPdf = $("resume-tab-pdf");
  const resumeAddForm = $("resume-add-form");
  const resumePanelLatex = $("resume-panel-latex");
  const resumePanelPdf = $("resume-panel-pdf");
  const resumeLatexInput = $("resume-latex-input");
  const resumeLatexCount = $("resume-latex-count");
  const pdfDropzone = $("pdf-dropzone");
  const pdfFileInput = $("pdf-file-input");
  const pdfBrowseButton = $("pdf-browse-button");
  const pdfFileChip = $("pdf-file-chip");
  const pdfFileName = $("pdf-file-name");
  const pdfFileClear = $("pdf-file-clear");
  const resumeNameField = $("resume-name-field");
  const resumeNameInput = $("resume-name-input");
  const resumeProviderSelect = $("resume-provider-select");
  const resumeProviderNote = $("resume-provider-note");
  const resumeModelInput = $("resume-model-input");
  const resumeAddError = $("resume-add-error");
  const resumeAddErrorMessage = $("resume-add-error-message");
  const resumeAddWarnings = $("resume-add-warnings");
  const resumeAddWarningsList = $("resume-add-warnings-list");
  const resumeAddButton = $("resume-add-button");
  const resumesCount = $("resumes-count");
  const resumesLoading = $("resumes-loading");
  const resumesError = $("resumes-error");
  const resumesErrorMessage = $("resumes-error-message");
  const resumesRetry = $("resumes-retry");
  const resumesEmpty = $("resumes-empty");
  const resumesList = $("resumes-list");

  // JDs
  const jdForm = $("jd-form");
  const jdTitleInput = $("jd-title-input");
  const jdContentInput = $("jd-content-input");
  const jdContentCount = $("jd-content-count");
  const jdFormError = $("jd-form-error");
  const jdFormErrorMessage = $("jd-form-error-message");
  const jdCreateButton = $("jd-create-button");
  const jdsCount = $("jds-count");
  const jdsLoading = $("jds-loading");
  const jdsError = $("jds-error");
  const jdsErrorMessage = $("jds-error-message");
  const jdsRetry = $("jds-retry");
  const jdsEmpty = $("jds-empty");
  const jdsList = $("jds-list");

  // History
  const historyListWrap = $("history-list-wrap");
  const historyLoading = $("history-loading");
  const historyError = $("history-error");
  const historyErrorMessage = $("history-error-message");
  const historyRetry = $("history-retry");
  const historyEmpty = $("history-empty");
  const historyList = $("history-list");
  const runDetail = $("run-detail");
  const runBackButton = $("run-back-button");
  const runDetailMeta = $("run-detail-meta");
  const runCompileButton = $("run-compile-button");
  const runTexDownload = $("run-tex-download");
  const runDeleteButton = $("run-delete-button");
  const runLoading = $("run-loading");
  const runError = $("run-error");
  const runErrorMessage = $("run-error-message");
  const runWarnings = $("run-warnings");
  const runWarningsList = $("run-warnings-list");
  const runDetailBody = $("run-detail-body");
  const runChangeCount = $("run-change-count");
  const runChangesList = $("run-changes-list");
  const runPdfDownload = $("run-pdf-download");
  const runPdfPreview = $("run-pdf-preview");
  const runPdfEmpty = $("run-pdf-empty");
  const runDiff = $("run-diff");

  // Settings
  const settingsLoading = $("settings-loading");
  const settingsError = $("settings-error");
  const settingsErrorMessage = $("settings-error-message");
  const settingsRetry = $("settings-retry");
  const settingsBody = $("settings-body");
  const keysList = $("keys-list");
  const defaultsForm = $("defaults-form");
  const defaultProviderSelect = $("default-provider-select");
  const defaultModelInput = $("default-model-input");
  const defaultsError = $("defaults-error");
  const defaultsErrorMessage = $("defaults-error-message");
  const defaultsSaveButton = $("defaults-save-button");
  const accountForm = $("account-form");
  const accountEmail = $("account-email");
  const accountNameInput = $("account-name-input");
  const accountError = $("account-error");
  const accountErrorMessage = $("account-error-message");
  const accountSaveButton = $("account-save-button");
  const settingsLogoutButton = $("settings-logout-button");
  const deleteAccountButton = $("delete-account-button");

  // Modals
  const confirmModalRoot = $("confirm-modal");
  const confirmModalTitle = $("confirm-modal-title");
  const confirmModalMessage = $("confirm-modal-message");
  const confirmModalCancel = $("confirm-modal-cancel");
  const confirmModalConfirm = $("confirm-modal-confirm");
  const deleteAccountModal = $("delete-account-modal");
  const deleteAccountForm = $("delete-account-form");
  const deletePasswordInput = $("delete-password-input");
  const deleteAccountError = $("delete-account-error");
  const deleteAccountErrorMessage = $("delete-account-error-message");
  const deleteAccountCancel = $("delete-account-cancel");
  const deleteAccountConfirm = $("delete-account-confirm");

  /* ----------------------------------------------------------------- state */

  const state = {
    booted: false,
    mode: "demo",
    user: null,
    providers: [],
    providersPromise: null,
    route: "",
    tailor: {
      dataVersion: 0,
      previewVersion: 0,
      requestVersion: 0,
      controller: null,
      progressTimer: null,
      pdfUrl: null,
      texUrl: null,
      lastRunId: "",
      preselectResumeId: "",
      preselectJdId: "",
    },
    resumes: {
      items: [],
      listVersion: 0,
      addMode: { type: "create", resumeId: "", resumeName: "" },
      pendingFile: null,
    },
    jds: {
      items: [],
      listVersion: 0,
      detailCache: new Map(),
    },
    history: {
      items: [],
      listVersion: 0,
      detailVersion: 0,
      openRunId: "",
      currentRun: null,
      pdfUrl: null,
      texUrl: null,
    },
    settings: {
      loadVersion: 0,
    },
  };

  /* --------------------------------------------------------------- helpers */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function smallButton(label, extraClass) {
    const button = el("button", "button button--small " + (extraClass || "button--secondary"), label);
    button.type = "button";
    return button;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  function excerptText(value, maximum) {
    const text = readableValue(value).replace(/\s+/g, " ").trim();
    const limit = maximum || 160;
    return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
      return "";
    }
    if (bytes >= 1_000_000) {
      return (bytes / 1_000_000).toFixed(1) + " MB";
    }
    if (bytes >= 1_000) {
      return Math.round(bytes / 1_000) + " KB";
    }
    return bytes + " B";
  }

  function slugify(value) {
    const base = readableValue(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return base || "resume";
  }

  function bindCounter(input, output, maximum) {
    const update = () => {
      const length = input.value.length;
      output.textContent = numberFormat.format(length) + " / " + numberFormat.format(maximum);
      output.classList.toggle("is-near-limit", length >= maximum * 0.9);
    };
    input.addEventListener("input", update);
    update();
    return update;
  }

  function setBusy(button, busy, busyLabel) {
    const label = button.querySelector(".button-label");
    if (busy) {
      if (label) {
        if (!button.dataset.idleLabel) {
          button.dataset.idleLabel = label.textContent;
        }
        if (busyLabel) {
          label.textContent = busyLabel;
        }
      }
      button.disabled = true;
      button.classList.add("is-loading");
    } else {
      if (label && button.dataset.idleLabel) {
        label.textContent = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
      }
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function showNotice(panel, messageEl, text, focus) {
    messageEl.textContent = text;
    panel.hidden = false;
    if (focus !== false) {
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    }
  }

  function hideNotice(panel, messageEl) {
    panel.hidden = true;
    if (messageEl) {
      messageEl.textContent = "";
    }
  }

  function downloadTextFile(text, filename) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function startTimeout(controller, ms) {
    const token = { timedOut: false, clear: () => {} };
    const timer = window.setTimeout(() => {
      token.timedOut = true;
      controller.abort();
    }, ms);
    token.clear = () => window.clearTimeout(timer);
    return token;
  }

  /* --------------------------------------------------------------- fetch */

  class ApiError extends Error {
    constructor(message, status, code, retryAfter) {
      super(message);
      this.name = "ApiError";
      this.status = status || 0;
      this.code = code || "";
      this.retryAfter = retryAfter || null;
    }
  }

  async function parsePayload(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        return await response.json();
      } catch (_error) {
        return null;
      }
    }
    try {
      const text = await response.text();
      return text ? { detail: text } : {};
    } catch (_error) {
      return {};
    }
  }

  function extractErrorParts(payload) {
    let code = "";
    let message = "";
    const detail = payload && payload.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      code = typeof detail.code === "string" ? detail.code : "";
      message = typeof detail.message === "string" ? detail.message : "";
    } else if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      code = "validation_error";
      message = detail
        .map((item) => readableValue(item && (item.msg !== undefined ? item.msg : item.message)))
        .filter(Boolean)
        .join(" ");
    }
    if (!message && payload && typeof payload === "object") {
      message = readableValue(payload.message !== undefined ? payload.message : payload.error).trim();
    }
    return { code, message };
  }

  function fallbackByStatus(status) {
    if (status === 429) {
      return "Too many requests right now. Wait a moment and try again.";
    }
    if (status === 413) {
      return "That request is too large. Shorten the content and try again.";
    }
    if (status === 422) {
      return "The submitted data could not be validated. Please revise it and try again.";
    }
    if (status >= 500) {
      return "The server could not finish this request. Please try again in a moment.";
    }
    return "The request could not be completed. Please try again.";
  }

  function friendlyMessage(code, serverMessage, status, retryAfter) {
    let base = ERROR_COPY[code] || "";
    if (!base && serverMessage && serverMessage.trim()) {
      base = serverMessage.trim();
    }
    if (!base) {
      base = fallbackByStatus(status);
    }
    if (status === 429) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        base += " Try again in about " + Math.ceil(seconds) + "s.";
      }
    }
    return base;
  }

  async function api(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: opts.signal,
    };
    if (opts.formData) {
      init.body = opts.formData;
    } else if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw error;
      }
      throw new ApiError(ERROR_COPY.network_error, 0, "network_error");
    }
    const payload = await parsePayload(response);
    if (!response.ok) {
      const parts = extractErrorParts(payload);
      const retryAfter = response.headers.get("Retry-After");
      const apiError = new ApiError(
        friendlyMessage(parts.code, parts.message, response.status, retryAfter),
        response.status,
        parts.code,
        retryAfter
      );
      if (response.status === 401 && parts.code === "not_authenticated" && !opts.quiet401) {
        handleSessionLost();
      }
      throw apiError;
    }
    return payload || {};
  }

  function errorText(error, fallback) {
    if (error instanceof ApiError) {
      return error.message;
    }
    if (error && error.name === "AbortError") {
      return fallback || "The request was interrupted. Please try again.";
    }
    return fallback || ERROR_COPY.network_error;
  }

  /* ---------------------------------------------------------------- toast */

  function toast(message, kind) {
    const item = el("div", "toast" + (kind ? " toast--" + kind : ""), message);
    toastRegion.append(item);
    window.setTimeout(() => {
      item.remove();
    }, 6_000);
  }

  /* --------------------------------------------------------------- modals */

  let confirmResolve = null;
  let confirmLastFocus = null;
  let deleteAccountLastFocus = null;

  function trapModalTab(event, modalRoot) {
    if (event.key !== "Tab") {
      return;
    }
    const nodes = Array.from(
      modalRoot.querySelectorAll("button, input, select, textarea, [href]")
    ).filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
    if (!nodes.length) {
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openConfirm(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmLastFocus = document.activeElement;
      confirmModalTitle.textContent = opts.title || "Are you sure?";
      confirmModalMessage.textContent = opts.message || "";
      confirmModalConfirm.textContent = opts.confirmLabel || "Delete";
      confirmModalRoot.hidden = false;
      confirmModalConfirm.focus();
    });
  }

  function closeConfirm(result) {
    if (!confirmResolve) {
      return;
    }
    confirmModalRoot.hidden = true;
    const resolve = confirmResolve;
    confirmResolve = null;
    if (confirmLastFocus && typeof confirmLastFocus.focus === "function") {
      confirmLastFocus.focus();
    }
    confirmLastFocus = null;
    resolve(Boolean(result));
  }

  function openDeleteAccountModal() {
    deleteAccountLastFocus = document.activeElement;
    deletePasswordInput.value = "";
    hideNotice(deleteAccountError, deleteAccountErrorMessage);
    deleteAccountModal.hidden = false;
    deletePasswordInput.focus();
  }

  function closeDeleteAccountModal() {
    deleteAccountModal.hidden = true;
    deletePasswordInput.value = "";
    if (deleteAccountLastFocus && typeof deleteAccountLastFocus.focus === "function") {
      deleteAccountLastFocus.focus();
    }
    deleteAccountLastFocus = null;
  }

  /* ----------------------------------------------------------------- tabs */

  function setupTabs(pairs, options) {
    const opts = options || {};
    const control = {
      current: 0,
      activate(index, focusTab) {
        control.current = index;
        pairs.forEach((pair, i) => {
          const selected = i === index;
          pair.tab.setAttribute("aria-selected", String(selected));
          pair.tab.tabIndex = selected ? 0 : -1;
          pair.panel.hidden = !selected;
        });
        if (focusTab) {
          pairs[index].tab.focus();
        }
        if (opts.onChange) {
          opts.onChange(index);
        }
      },
    };
    pairs.forEach((pair, index) => {
      pair.tab.addEventListener("click", () => control.activate(index));
      pair.tab.addEventListener("keydown", (event) => {
        let target = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          target = (index + 1) % pairs.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          target = (index - 1 + pairs.length) % pairs.length;
        } else if (event.key === "Home") {
          target = 0;
        } else if (event.key === "End") {
          target = pairs.length - 1;
        }
        if (target !== null) {
          event.preventDefault();
          control.activate(target, true);
        }
      });
    });
    return control;
  }

  const authTabs = setupTabs([
    { tab: authTabLogin, panel: loginForm },
    { tab: authTabRegister, panel: registerForm },
  ]);
  const tailorJdTabs = setupTabs([
    { tab: jdTabSaved, panel: jdPanelSaved },
    { tab: jdTabPaste, panel: jdPanelPaste },
  ]);
  const resumeTabs = setupTabs([
    { tab: resumeTabLatex, panel: resumePanelLatex },
    { tab: resumeTabPdf, panel: resumePanelPdf },
  ]);

  /* --------------------------------------------------------------- router */

  function parseRoute() {
    const raw = (window.location.hash || "").replace(/^#\/?/, "");
    const name = raw.split("/")[0].split("?")[0];
    return ROUTES.includes(name) ? name : "";
  }

  function resolveRoute(requested) {
    if (state.mode === "demo") {
      return "tailor";
    }
    if (!state.user) {
      return "auth";
    }
    if (!requested || requested === "auth") {
      return "tailor";
    }
    return requested;
  }

  function navigate(route) {
    const target = "#/" + route;
    if (window.location.hash === target) {
      handleRoute();
    } else {
      window.location.hash = target;
    }
  }

  function handleRoute() {
    if (!state.booted) {
      return;
    }
    const requested = parseRoute();
    const target = resolveRoute(requested);
    if (requested !== target) {
      window.location.replace("#/" + target);
      return;
    }
    showView(target);
  }

  function showView(route) {
    Object.keys(viewElements).forEach((name) => {
      viewElements[name].hidden = name !== route;
    });
    document.querySelectorAll("#app-nav a").forEach((link) => {
      if (link.dataset.route === route) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    const changed = state.route !== route;
    state.route = route;
    onViewEnter(route);
    if (changed) {
      window.scrollTo({ top: 0, behavior: "auto" });
      const title = viewTitles[route];
      if (title) {
        title.focus({ preventScroll: true });
      }
    }
  }

  function onViewEnter(route) {
    if (route === "tailor") {
      loadTailorData();
    } else if (route === "resumes") {
      loadResumes();
    } else if (route === "jds") {
      loadJds();
    } else if (route === "history") {
      loadHistory();
    } else if (route === "settings") {
      loadSettings();
    }
  }

  /* --------------------------------------------------------------- chrome */

  function updateChrome() {
    const authed = state.mode === "multi_user" && Boolean(state.user);
    appNav.hidden = !authed;
    userChip.hidden = !authed;
    if (authed) {
      userChipName.textContent = state.user.name || state.user.email || "";
    } else {
      userChipName.textContent = "";
    }
    demoBanner.hidden = state.mode !== "demo";
    document.querySelectorAll("[data-auth-only]").forEach((node) => {
      node.hidden = state.mode === "demo";
    });
    if (state.mode === "demo") {
      tailorJdTabs.activate(1);
    }
  }

  function handleSessionLost() {
    if (state.mode !== "multi_user") {
      return;
    }
    const hadUser = Boolean(state.user);
    state.user = null;
    clearUserCaches();
    updateChrome();
    if (hadUser) {
      toast("Your session expired — please sign in again.", "error");
    }
    if (state.booted) {
      navigate("auth");
    }
  }

  function clearUserCaches() {
    state.resumes.items = [];
    state.resumes.pendingFile = null;
    state.jds.items = [];
    state.jds.detailCache.clear();
    state.history.items = [];
    state.history.currentRun = null;
    state.history.openRunId = "";
    state.tailor.preselectResumeId = "";
    state.tailor.preselectJdId = "";
    state.tailor.lastRunId = "";
    releaseRunAssets();
    resetWorkspace({ focus: false });
  }

  /* ------------------------------------------------------------ providers */

  function ensureProviders() {
    if (state.providers.length) {
      return Promise.resolve(state.providers);
    }
    if (!state.providersPromise) {
      state.providersPromise = api("/api/providers")
        .then((payload) => {
          state.providers = Array.isArray(payload.providers) ? payload.providers : [];
          return state.providers;
        })
        .catch((error) => {
          state.providersPromise = null;
          throw error;
        });
    }
    return state.providersPromise;
  }

  function providerLabel(providerId) {
    const found = state.providers.find((provider) => provider && provider.id === providerId);
    if (found && found.label) {
      return found.label;
    }
    if (providerId === "mock") {
      return "Mock (offline)";
    }
    return readableValue(providerId);
  }

  function setSelectPlaceholder(select, label, disabled) {
    select.replaceChildren(new Option(label, ""));
    select.disabled = disabled !== false;
  }

  function populateProviderSelect(select, noteEl) {
    const user = state.user;
    const previous = select.value;
    select.replaceChildren();
    const keyed = user && Array.isArray(user.providers_with_keys) ? user.providers_with_keys : [];
    if (user && user.default_provider) {
      select.append(new Option("Account default — " + providerLabel(user.default_provider), ""));
    }
    keyed.forEach((providerId) => {
      select.append(new Option(providerLabel(providerId), providerId));
    });
    if (!keyed.includes("mock")) {
      select.append(new Option("Mock (offline dry run)", "mock"));
    }
    const values = Array.from(select.options).map((option) => option.value);
    if (previous && values.includes(previous)) {
      select.value = previous;
    } else if (user && user.default_provider && values.includes("")) {
      select.value = "";
    } else if (keyed.length) {
      select.value = keyed[0];
    } else {
      select.value = "mock";
    }
    select.disabled = false;
    if (noteEl) {
      noteEl.hidden = keyed.length > 0;
    }
  }

  /* ----------------------------------------------------------------- boot */

  async function boot() {
    bootErrorPanel.hidden = true;
    bootLoading.hidden = false;
    let health = null;
    try {
      const response = await fetch("/api/health", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        health = await response.json();
      }
    } catch (_error) {
      health = null;
    }
    if (!health || typeof health !== "object") {
      bootLoading.hidden = true;
      bootErrorMessage.textContent =
        "The server did not respond to the health check. It may still be starting up.";
      bootErrorPanel.hidden = false;
      return;
    }
    state.mode = health.mode === "multi_user" ? "multi_user" : "demo";

    if (state.mode === "multi_user") {
      try {
        const payload = await api("/api/me", { quiet401: true });
        state.user = payload && payload.user ? payload.user : null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          state.user = null;
        } else {
          bootLoading.hidden = true;
          bootErrorMessage.textContent = errorText(error, "Could not load your account.");
          bootErrorPanel.hidden = false;
          return;
        }
      }
      ensureProviders().catch(() => {});
    }

    bootLoading.hidden = true;
    state.booted = true;
    updateChrome();
    handleRoute();
  }

  /* ----------------------------------------------------------------- auth */

  async function handleLogin(event) {
    event.preventDefault();
    hideNotice(loginError, loginErrorMessage);
    const email = loginEmail.value.trim().toLowerCase();
    const password = loginPassword.value;
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      showNotice(loginError, loginErrorMessage, "Enter a valid email address.");
      loginEmail.focus();
      return;
    }
    if (!password) {
      showNotice(loginError, loginErrorMessage, "Enter your password.");
      loginPassword.focus();
      return;
    }
    setBusy(loginButton, true, "Signing in…");
    try {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
        quiet401: true,
      });
      completeAuth(payload, "Welcome back!");
    } catch (error) {
      showNotice(loginError, loginErrorMessage, errorText(error));
    } finally {
      setBusy(loginButton, false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    hideNotice(registerError, registerErrorMessage);
    const name = registerName.value.trim();
    const email = registerEmail.value.trim().toLowerCase();
    const password = registerPassword.value;
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      showNotice(registerError, registerErrorMessage, "Enter a valid email address.");
      registerEmail.focus();
      return;
    }
    if (password.length < 8 || password.length > 128) {
      showNotice(registerError, registerErrorMessage, ERROR_COPY.weak_password);
      registerPassword.focus();
      return;
    }
    const body = { email, password };
    if (name) {
      body.name = name;
    }
    setBusy(registerButton, true, "Creating account…");
    try {
      const payload = await api("/api/auth/register", { method: "POST", body });
      completeAuth(payload, "Account created — welcome!");
    } catch (error) {
      showNotice(registerError, registerErrorMessage, errorText(error));
    } finally {
      setBusy(registerButton, false);
    }
  }

  function completeAuth(payload, message) {
    const user = payload && payload.user ? payload.user : null;
    if (!user) {
      toast("The server returned an unexpected sign-in response.", "error");
      return;
    }
    state.user = user;
    loginPassword.value = "";
    registerPassword.value = "";
    ensureProviders().catch(() => {});
    updateChrome();
    navigate("tailor");
    toast(message, "success");
  }

  async function handleLogout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_error) {
      /* The cookie may already be dead; sign out locally regardless. */
    }
    state.user = null;
    clearUserCaches();
    updateChrome();
    navigate("auth");
    toast("Signed out.", "success");
  }

  /* --------------------------------------------------------- tailor: data */

  const jdMaximumCharacters = Number(jobDescription.maxLength) || 20_000;
  const jdMinimumCharacters = Number(jobDescription.minLength) || 50;

  const progressMessages = [
    "Reading the role and your experience…",
    "Refining the editable resume fields…",
    "Validating every suggested change…",
    "Compiling your protected LaTeX template…",
    "Running final PDF checks…",
  ];

  async function loadTailorData() {
    if (state.mode !== "multi_user" || !state.user) {
      return;
    }
    const version = ++state.tailor.dataVersion;
    hideNotice(tailorLoadError, tailorLoadErrorMessage);
    tailorResumeEmpty.hidden = true;
    tailorJdEmpty.hidden = true;
    // Capture the current selections before the placeholders wipe them so a
    // round-trip to another view does not silently reset the chosen pair.
    const previousResumeId = tailorResumeSelect.value;
    const previousJdId = tailorJdSelect.value;
    setSelectPlaceholder(tailorResumeSelect, "Loading resumes…");
    setSelectPlaceholder(tailorJdSelect, "Loading saved JDs…");
    populateProviderSelect(tailorProviderSelect, tailorProviderNote);
    try {
      const [resumesPayload, jdsPayload] = await Promise.all([api("/api/resumes"), api("/api/jds")]);
      if (version !== state.tailor.dataVersion) {
        return;
      }
      state.resumes.items = Array.isArray(resumesPayload.resumes) ? resumesPayload.resumes : [];
      state.jds.items = Array.isArray(jdsPayload.jds) ? jdsPayload.jds : [];
      populateTailorResumeSelect(previousResumeId);
      populateTailorJdSelect(previousJdId);
    } catch (error) {
      if (version !== state.tailor.dataVersion) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      setSelectPlaceholder(tailorResumeSelect, "Unavailable");
      setSelectPlaceholder(tailorJdSelect, "Unavailable");
      showNotice(tailorLoadError, tailorLoadErrorMessage, errorText(error, "Could not load your libraries."), false);
    }
  }

  function populateTailorResumeSelect(previousResumeId) {
    const items = state.resumes.items;
    const previous =
      state.tailor.preselectResumeId || previousResumeId || tailorResumeSelect.value;
    state.tailor.preselectResumeId = "";
    if (!items.length) {
      setSelectPlaceholder(tailorResumeSelect, "No resumes yet");
      tailorResumeEmpty.hidden = false;
      return;
    }
    tailorResumeSelect.replaceChildren();
    items.forEach((resume) => {
      tailorResumeSelect.append(new Option(resume.name + " · v" + resume.version, resume.id));
    });
    tailorResumeSelect.disabled = false;
    if (previous && items.some((resume) => resume.id === previous)) {
      tailorResumeSelect.value = previous;
    }
    tailorResumeEmpty.hidden = true;
  }

  function populateTailorJdSelect(previousJdId) {
    const items = state.jds.items;
    const preselect = state.tailor.preselectJdId;
    const previous = preselect || previousJdId || tailorJdSelect.value;
    state.tailor.preselectJdId = "";
    if (!items.length) {
      setSelectPlaceholder(tailorJdSelect, "No saved JDs yet");
      tailorJdEmpty.hidden = false;
      tailorJdPreview.hidden = true;
      return;
    }
    tailorJdSelect.replaceChildren();
    items.forEach((jd) => {
      tailorJdSelect.append(new Option(jd.title + " · v" + jd.version, jd.id));
    });
    tailorJdSelect.disabled = false;
    if (previous && items.some((jd) => jd.id === previous)) {
      tailorJdSelect.value = previous;
    }
    tailorJdEmpty.hidden = true;
    if (preselect) {
      tailorJdTabs.activate(0);
    }
    loadJdPreview(tailorJdSelect.value);
  }

  async function loadJdPreview(jdId) {
    const version = ++state.tailor.previewVersion;
    if (!jdId) {
      tailorJdPreview.hidden = true;
      tailorJdPreviewStatus.hidden = true;
      return;
    }
    const cached = state.jds.detailCache.get(jdId);
    if (cached) {
      tailorJdPreview.textContent = cached.content || "";
      tailorJdPreview.hidden = false;
      tailorJdPreviewStatus.hidden = true;
      return;
    }
    tailorJdPreviewStatus.hidden = false;
    tailorJdPreview.hidden = true;
    try {
      const payload = await api("/api/jds/" + encodeURIComponent(jdId));
      if (version !== state.tailor.previewVersion) {
        return;
      }
      const jd = payload.jd || {};
      if (jd.id) {
        state.jds.detailCache.set(jd.id, jd);
      }
      tailorJdPreview.textContent = jd.content || "";
      tailorJdPreview.hidden = false;
    } catch (_error) {
      if (version !== state.tailor.previewVersion) {
        return;
      }
      tailorJdPreview.hidden = true;
    } finally {
      if (version === state.tailor.previewVersion) {
        tailorJdPreviewStatus.hidden = true;
      }
    }
  }

  /* ------------------------------------------------------- tailor: submit */

  function clearError() {
    hideNotice(errorPanel, errorMessage);
  }

  function showError(message) {
    showNotice(errorPanel, errorMessage, message);
  }

  function startProgressMessages() {
    stopProgressMessages();
    let index = 0;
    loadingMessage.textContent = progressMessages[index];
    state.tailor.progressTimer = window.setInterval(() => {
      index = Math.min(index + 1, progressMessages.length - 1);
      loadingMessage.textContent = progressMessages[index];
      if (index === progressMessages.length - 1) {
        stopProgressMessages();
      }
    }, 5_000);
  }

  function stopProgressMessages() {
    if (state.tailor.progressTimer !== null) {
      window.clearInterval(state.tailor.progressTimer);
      state.tailor.progressTimer = null;
    }
  }

  function setLoading(isLoading) {
    tailorForm.classList.toggle("is-loading", isLoading);
    tailorForm.setAttribute("aria-busy", String(isLoading));
    submitButton.disabled = isLoading;
    jobDescription.disabled = isLoading;
    submitButton.classList.toggle("is-loading", isLoading);
    const label = submitButton.querySelector(".button-label");
    if (label) {
      label.textContent = isLoading ? "Tailoring…" : "Tailor my resume";
    }
    loadingPanel.hidden = !isLoading;
    if (isLoading) {
      startProgressMessages();
      window.requestAnimationFrame(() => {
        loadingPanel.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
      });
    } else {
      stopProgressMessages();
    }
  }

  function revokeTailorUrl(key) {
    if (state.tailor[key]) {
      URL.revokeObjectURL(state.tailor[key]);
      state.tailor[key] = null;
    }
  }

  function clearGeneratedFiles() {
    pdfPreview.removeAttribute("src");
    revokeTailorUrl("pdfUrl");
    revokeTailorUrl("texUrl");
    pdfDownload.removeAttribute("href");
    texDownload.removeAttribute("href");
  }

  function resetWorkspace(options) {
    const opts = options || {};
    state.tailor.requestVersion += 1;
    if (state.tailor.controller) {
      state.tailor.controller.abort();
      state.tailor.controller = null;
    }
    setLoading(false);
    clearError();
    clearGeneratedFiles();
    results.hidden = true;
    runChip.hidden = true;
    state.tailor.lastRunId = "";
    jobDescription.disabled = false;
    jobDescription.value = "";
    updateJdCharacterCount();
    saveJdCheckbox.checked = false;
    saveJdTitle.value = "";
    saveJdTitle.hidden = true;
    if (opts.focus !== false && state.route === "tailor") {
      viewElements.tailor.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
      if (state.mode === "multi_user" && tailorJdTabs.current === 0) {
        tailorJdSelect.focus({ preventScroll: true });
      } else {
        jobDescription.focus({ preventScroll: true });
      }
    }
  }

  async function handleTailorSubmit(event) {
    event.preventDefault();
    clearError();

    const isDemo = state.mode === "demo";
    const usingSaved = !isDemo && tailorJdTabs.current === 0;
    const requestBody = {
      compile: compileToggle.checked,
      require_one_page: onePageToggle.checked,
    };

    let description = "";
    let saveJdRequest = null;

    if (usingSaved) {
      const jdId = tailorJdSelect.value;
      if (!jdId) {
        showError("Pick a saved job description, or switch to “Paste new”.");
        tailorJdSelect.focus();
        return;
      }
      requestBody.jd_id = jdId;
    } else {
      description = jobDescription.value.trim();
      if (!description) {
        showError("Paste a job description before tailoring your resume.");
        jobDescription.focus();
        return;
      }
      if (description.length < jdMinimumCharacters) {
        showError("Add a little more detail — the job description must be at least " + jdMinimumCharacters + " characters.");
        jobDescription.focus();
        return;
      }
      if (description.length > jdMaximumCharacters) {
        showError("Shorten the job description to " + numberFormat.format(jdMaximumCharacters) + " characters or fewer.");
        jobDescription.focus();
        return;
      }
      requestBody.job_description = description;
      if (!isDemo && saveJdCheckbox.checked) {
        const title = saveJdTitle.value.trim();
        if (!title) {
          showError("Add a title for the JD you’re saving, or untick “Save to my JDs”.");
          saveJdTitle.hidden = false;
          saveJdTitle.focus();
          return;
        }
        saveJdRequest = { title, content: description };
      }
    }

    if (!isDemo) {
      const resumeId = tailorResumeSelect.value;
      if (!resumeId) {
        showError("Pick one of your resumes first — you can add one on the Resumes page.");
        tailorResumeSelect.focus();
        return;
      }
      requestBody.resume_id = resumeId;
      const provider = tailorProviderSelect.value;
      if (provider) {
        requestBody.provider = provider;
      }
      const model = tailorModelInput.value.trim();
      if (model) {
        requestBody.model = model;
      }
    }

    state.tailor.requestVersion += 1;
    const currentRequest = state.tailor.requestVersion;
    const controller = new AbortController();
    state.tailor.controller = controller;
    const timeoutToken = startTimeout(controller, REQUEST_TIMEOUT_MS);

    results.hidden = true;
    clearGeneratedFiles();
    setLoading(true);

    try {
      if (saveJdRequest) {
        const jdPayload = await api("/api/jds", {
          method: "POST",
          body: saveJdRequest,
          signal: controller.signal,
        });
        const jd = jdPayload.jd;
        if (currentRequest !== state.tailor.requestVersion) {
          return;
        }
        if (jd && jd.id) {
          state.jds.detailCache.set(jd.id, jd);
          requestBody.jd_id = jd.id;
          delete requestBody.job_description;
          saveJdCheckbox.checked = false;
          saveJdTitle.value = "";
          saveJdTitle.hidden = true;
          toast("Saved “" + jd.title + "” to your JDs.", "success");
        }
      }

      const payload = await api("/api/tailor", {
        method: "POST",
        body: requestBody,
        signal: controller.signal,
      });
      if (currentRequest !== state.tailor.requestVersion) {
        return;
      }
      const data = normalizeResponse(payload);
      setLoading(false);
      renderResult(data);
    } catch (error) {
      if (currentRequest !== state.tailor.requestVersion) {
        return;
      }
      if (error && error.name === "AbortError" && !timeoutToken.timedOut) {
        return;
      }
      setLoading(false);
      if (timeoutToken.timedOut) {
        showError("The request took longer than three minutes. The server may be waking up — please try once more.");
      } else {
        showError(errorText(error));
      }
    } finally {
      timeoutToken.clear();
      if (currentRequest === state.tailor.requestVersion) {
        if (state.tailor.controller === controller) {
          state.tailor.controller = null;
        }
        setLoading(false);
      }
    }
  }

  /* ------------------------------------------------------ tailor: results */

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
          ? readableValue(item.field) + " · " + readableValue(item.id)
          : id;
        return {
          label: humanizeFieldId(field, "Change " + (index + 1)),
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
    return /\.pdf$/i.test(safeName) ? safeName : safeName.replace(/\.[^.]+$/, "") + ".pdf";
  }

  function normalizeResponse(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError("The server returned an unexpected response. Please try again.", 0, "bad_response");
    }
    const compiler = payload.compiler && typeof payload.compiler === "object" ? payload.compiler : {};
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
      runId: readableValue(payload.run_id).trim(),
    };
  }

  function base64ToPdfBlob(value) {
    const commaIndex = value.indexOf(",");
    const encoded = value.startsWith("data:") && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
    const clean = encoded.replace(/\s/g, "");
    if (!clean) {
      return null;
    }
    let binary;
    try {
      binary = window.atob(clean);
    } catch (_error) {
      throw new ApiError("The compiled PDF was returned in an invalid format. Please try again.", 0, "bad_pdf");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: "application/pdf" });
  }

  function appendChangeBlock(card, kind, text) {
    const block = el("div", "change-block change-block--" + kind);
    const label = el("span", "change-label", kind === "before" ? "Original" : "Tailored");
    const content = document.createElement(kind === "before" ? "del" : "ins");
    content.className = "change-text";
    content.textContent = text || (kind === "before" ? "No previous content" : "Content removed");
    content.classList.toggle("is-empty", !text);
    block.append(label, content);
    card.append(block);
  }

  function renderChangesInto(container, countEl, changes) {
    container.replaceChildren();
    countEl.textContent = changes.length + " " + (changes.length === 1 ? "change" : "changes");
    if (changes.length === 0) {
      const empty = el("div", "changes-empty");
      empty.append(
        el("strong", "", "No wording changes returned"),
        el("span", "", "The generated resume may already match the original content.")
      );
      container.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    changes.forEach((change) => {
      const card = el("article", "change-card");
      card.append(el("h4", "change-title", change.label));
      appendChangeBlock(card, "before", change.before);
      const connector = el("span", "change-connector", "↓");
      connector.setAttribute("aria-hidden", "true");
      card.append(connector);
      appendChangeBlock(card, "after", change.after);
      fragment.append(card);
    });
    container.append(fragment);
  }

  function renderWarningsInto(panel, listEl, warnings) {
    listEl.replaceChildren();
    panel.hidden = warnings.length === 0;
    if (warnings.length === 0) {
      return;
    }
    const fragment = document.createDocumentFragment();
    warnings.forEach((warning) => {
      fragment.append(el("li", "", warning));
    });
    listEl.append(fragment);
  }

  function renderDownloads(data) {
    clearGeneratedFiles();
    previewFilename.textContent = data.filename;
    pdfDownload.download = data.filename;
    const pdfBlob = data.pdfBase64 ? base64ToPdfBlob(data.pdfBase64) : null;
    if (pdfBlob) {
      state.tailor.pdfUrl = URL.createObjectURL(pdfBlob);
      pdfPreview.src = state.tailor.pdfUrl + "#view=FitH";
      pdfPreview.hidden = false;
      previewEmpty.hidden = true;
      pdfDownload.href = state.tailor.pdfUrl;
      pdfDownload.hidden = false;
    } else {
      pdfPreview.hidden = true;
      previewEmpty.hidden = false;
      pdfDownload.hidden = true;
    }
    if (data.latexSource) {
      const texName = data.filename.replace(/\.pdf$/i, ".tex");
      const texBlob = new Blob([data.latexSource], { type: "text/plain;charset=utf-8" });
      state.tailor.texUrl = URL.createObjectURL(texBlob);
      texDownload.href = state.tailor.texUrl;
      texDownload.download = texName;
      texDownload.hidden = false;
    } else {
      texDownload.hidden = true;
    }
  }

  function renderResult(data) {
    const providerDetails = [data.provider, data.model].filter(Boolean);
    providerMeta.textContent = providerDetails.length ? providerDetails.join(" · ") : "Configured AI model";
    const numericPageCount = Number(data.pageCount);
    if (Number.isFinite(numericPageCount) && numericPageCount > 0) {
      pageMeta.textContent = numericPageCount + " " + (numericPageCount === 1 ? "page" : "pages");
    } else {
      pageMeta.textContent = data.pdfBase64 ? "PDF compiled" : "Source generated";
    }
    state.tailor.lastRunId = data.runId || "";
    runChip.hidden = !state.tailor.lastRunId;
    renderWarningsInto(warningsPanel, warningsList, data.warnings);
    renderChangesInto(changesList, changeCount, data.changes);
    renderDownloads(data);
    results.hidden = false;
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  /* -------------------------------------------------------------- resumes */

  const resumeLatexMaximum = Number(resumeLatexInput.maxLength) || 200_000;
  const resumeLatexMinimum = Number(resumeLatexInput.minLength) || 40;

  async function loadResumes() {
    if (state.mode !== "multi_user" || !state.user) {
      return;
    }
    populateProviderSelect(resumeProviderSelect, resumeProviderNote);
    const version = ++state.resumes.listVersion;
    resumesLoading.hidden = false;
    resumesError.hidden = true;
    resumesEmpty.hidden = true;
    try {
      const payload = await api("/api/resumes");
      if (version !== state.resumes.listVersion) {
        return;
      }
      state.resumes.items = Array.isArray(payload.resumes) ? payload.resumes : [];
      renderResumesList();
    } catch (error) {
      if (version !== state.resumes.listVersion) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      resumesErrorMessage.textContent = errorText(error, "Could not load your resumes.");
      resumesError.hidden = false;
    } finally {
      if (version === state.resumes.listVersion) {
        resumesLoading.hidden = true;
      }
    }
  }

  function renderResumesList() {
    const items = state.resumes.items;
    resumesCount.textContent = String(items.length);
    resumesEmpty.hidden = items.length > 0;
    resumesList.replaceChildren();
    const fragment = document.createDocumentFragment();
    items.forEach((resume) => {
      fragment.append(buildResumeCard(resume));
    });
    resumesList.append(fragment);
  }

  function buildResumeCard(resume) {
    const card = el("article", "item-card");

    const head = el("div", "item-head");
    const titleWrap = el("div", "item-title-wrap");
    const title = el("h3", "item-title", resume.name);
    const badges = el("div", "badge-row");
    badges.append(el("span", "badge badge--accent", resume.source_type === "pdf" ? "PDF" : "LaTeX"));
    badges.append(el("span", "badge", "v" + resume.version));
    titleWrap.append(title, badges);
    head.append(titleWrap);
    card.append(head);

    const metaParts = [];
    if (resume.provider) {
      metaParts.push(providerLabel(resume.provider) + (resume.model ? " · " + resume.model : ""));
    }
    if (resume.updated_at) {
      metaParts.push("Updated " + formatDate(resume.updated_at));
    }
    card.append(el("p", "item-meta", metaParts.join(" · ")));

    const actions = el("div", "item-actions");
    const tailorBtn = smallButton("Tailor", "button--primary");
    const renameBtn = smallButton("Rename");
    const newVersionBtn = smallButton("New version");
    const versionsBtn = smallButton("Versions");
    const detailsBtn = smallButton("Details");
    const deleteBtn = smallButton("Delete", "button--quiet button--danger-quiet");
    versionsBtn.setAttribute("aria-expanded", "false");
    detailsBtn.setAttribute("aria-expanded", "false");
    actions.append(tailorBtn, renameBtn, newVersionBtn, versionsBtn, detailsBtn, deleteBtn);
    card.append(actions);

    const expandArea = el("div");
    card.append(expandArea);
    let openKind = "";

    function closeExpand() {
      openKind = "";
      expandArea.replaceChildren();
      versionsBtn.setAttribute("aria-expanded", "false");
      detailsBtn.setAttribute("aria-expanded", "false");
    }

    function openBox(kind) {
      closeExpand();
      openKind = kind;
      const box = el("div", "expand-box");
      expandArea.append(box);
      return box;
    }

    tailorBtn.addEventListener("click", () => {
      state.tailor.preselectResumeId = resume.id;
      navigate("tailor");
    });

    renameBtn.addEventListener("click", () => {
      if (openKind === "rename") {
        closeExpand();
        return;
      }
      const box = openBox("rename");
      const form = el("form", "inline-form");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-input";
      input.maxLength = 120;
      input.value = resume.name;
      input.setAttribute("aria-label", "New name for " + resume.name);
      const actionsRow = el("div", "inline-form-actions");
      const saveBtn = smallButton("Save name", "button--primary");
      saveBtn.type = "submit";
      const cancelBtn = smallButton("Cancel", "button--quiet");
      cancelBtn.addEventListener("click", closeExpand);
      actionsRow.append(saveBtn, cancelBtn);
      form.append(input, actionsRow);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name || name.length > 120) {
          toast("Names must be 1–120 characters.", "error");
          input.focus();
          return;
        }
        saveBtn.disabled = true;
        try {
          await api("/api/resumes/" + encodeURIComponent(resume.id), {
            method: "PATCH",
            body: { name },
          });
          toast("Renamed to “" + name + "”.", "success");
          loadResumes();
        } catch (error) {
          toast(errorText(error), "error");
          saveBtn.disabled = false;
        }
      });
      box.append(form);
      input.focus();
      input.select();
    });

    newVersionBtn.addEventListener("click", () => {
      enterVersionMode(resume);
    });

    versionsBtn.addEventListener("click", async () => {
      if (openKind === "versions") {
        closeExpand();
        return;
      }
      const box = openBox("versions");
      versionsBtn.setAttribute("aria-expanded", "true");
      box.append(el("p", "list-status", "Loading versions…"));
      try {
        const payload = await api("/api/resumes/" + encodeURIComponent(resume.id) + "/versions");
        if (openKind !== "versions") {
          return;
        }
        const versions = Array.isArray(payload.versions) ? payload.versions : [];
        box.replaceChildren(el("h4", "", "Versions"));
        if (!versions.length) {
          box.append(el("p", "", "No versions recorded."));
          return;
        }
        versions.forEach((versionInfo) => {
          const row = el("div", "version-row");
          const main = el("div", "version-row-main");
          const strong = el("strong", "", "v" + versionInfo.version);
          main.append(strong);
          main.append(el("span", "badge", versionInfo.source_type === "pdf" ? "PDF" : "LaTeX"));
          const subParts = [];
          if (versionInfo.provider) {
            subParts.push(providerLabel(versionInfo.provider) + (versionInfo.model ? " · " + versionInfo.model : ""));
          }
          if (versionInfo.created_at) {
            subParts.push(formatDateTime(versionInfo.created_at));
          }
          main.append(el("span", "version-row-sub", subParts.join(" · ")));
          const sourceBtn = smallButton("Download source");
          sourceBtn.addEventListener("click", () => {
            downloadVersionSource(resume, versionInfo, sourceBtn);
          });
          row.append(main, sourceBtn);
          box.append(row);
        });
      } catch (error) {
        if (openKind !== "versions") {
          return;
        }
        box.replaceChildren(el("p", "", errorText(error, "Could not load versions.")));
      }
    });

    detailsBtn.addEventListener("click", async () => {
      if (openKind === "details") {
        closeExpand();
        return;
      }
      const box = openBox("details");
      detailsBtn.setAttribute("aria-expanded", "true");
      box.append(el("p", "list-status", "Loading extracted summary…"));
      try {
        const payload = await api("/api/resumes/" + encodeURIComponent(resume.id));
        if (openKind !== "details") {
          return;
        }
        const detail = payload.resume || {};
        const data = detail.data || {};
        const identity = data.identity || {};
        box.replaceChildren(el("h4", "", "Extracted summary"));
        if (identity.name) {
          const namePara = el("p");
          namePara.append(el("strong", "", identity.name));
          box.append(namePara);
        }
        if (data.summary) {
          box.append(el("p", "", excerptText(data.summary, 220)));
        }
        const counts = [
          countLabel(data.experience, "role", "roles"),
          countLabel(data.projects, "project", "projects"),
          countLabel(data.education, "education entry", "education entries"),
          countLabel(data.skills, "skill group", "skill groups"),
          countLabel(data.achievements, "achievement", "achievements"),
        ].filter(Boolean);
        if (counts.length) {
          box.append(el("p", "", counts.join(" · ")));
        }
      } catch (error) {
        if (openKind !== "details") {
          return;
        }
        box.replaceChildren(el("p", "", errorText(error, "Could not load the summary.")));
      }
    });

    deleteBtn.addEventListener("click", async () => {
      const confirmed = await openConfirm({
        title: "Delete “" + resume.name + "”?",
        message: "This deletes the resume and all of its versions. Past tailor runs stay in History.",
        confirmLabel: "Delete resume",
      });
      if (!confirmed) {
        return;
      }
      try {
        await api("/api/resumes/" + encodeURIComponent(resume.id), { method: "DELETE" });
        if (state.resumes.addMode.resumeId === resume.id) {
          exitVersionMode();
        }
        toast("Deleted “" + resume.name + "”.", "success");
        loadResumes();
      } catch (error) {
        toast(errorText(error), "error");
      }
    });

    return card;
  }

  function countLabel(list, singular, plural) {
    const count = Array.isArray(list) ? list.length : 0;
    if (!count) {
      return "";
    }
    return count + " " + (count === 1 ? singular : plural);
  }

  async function downloadVersionSource(resume, versionInfo, button) {
    button.disabled = true;
    try {
      const payload = await api(
        "/api/resumes/" + encodeURIComponent(resume.id) + "/versions/" + encodeURIComponent(versionInfo.version) + "/source"
      );
      const text = readableValue(payload.source_text) || readableValue(payload.template_tex);
      if (!text) {
        toast("No source is stored for this version.", "error");
        return;
      }
      const extension = payload.source_type === "pdf" ? ".txt" : ".tex";
      downloadTextFile(text, slugify(resume.name) + "-v" + versionInfo.version + extension);
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------------------------------------------- resumes: importer */

  function enterVersionMode(resume) {
    state.resumes.addMode = { type: "version", resumeId: resume.id, resumeName: resume.name };
    resumeAddStep.textContent = "New version";
    resumeAddTitle.textContent = "New version for " + resume.name;
    resumeNameField.hidden = true;
    resumeAddCancel.hidden = false;
    const label = resumeAddButton.querySelector(".button-label");
    if (label) {
      label.textContent = "Import new version";
    }
    hideResumeAddError();
    resumeAddPanel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    if (resumeTabs.current === 0) {
      resumeLatexInput.focus({ preventScroll: true });
    } else {
      pdfBrowseButton.focus({ preventScroll: true });
    }
  }

  function exitVersionMode() {
    state.resumes.addMode = { type: "create", resumeId: "", resumeName: "" };
    resumeAddStep.textContent = "Add a resume";
    resumeAddTitle.textContent = "Import your resume";
    resumeNameField.hidden = false;
    resumeAddCancel.hidden = true;
    const label = resumeAddButton.querySelector(".button-label");
    if (label) {
      label.textContent = "Import resume";
    }
  }

  function showResumeAddError(message) {
    resumeAddWarnings.hidden = true;
    showNotice(resumeAddError, resumeAddErrorMessage, message);
  }

  function hideResumeAddError() {
    hideNotice(resumeAddError, resumeAddErrorMessage);
  }

  function renderResumeAddWarnings(warnings) {
    const list = normalizeWarnings(warnings);
    renderWarningsInto(resumeAddWarnings, resumeAddWarningsList, list);
  }

  function validatePdfFile(file) {
    if (!file) {
      return "Choose a PDF file first.";
    }
    const name = file.name || "";
    const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
    if (!looksPdf) {
      return "That file doesn’t look like a PDF. Choose a .pdf file.";
    }
    if (file.size === 0) {
      return "That file is empty.";
    }
    if (file.size > MAX_PDF_BYTES) {
      return "That PDF is larger than 10 MB. Export a smaller copy and try again.";
    }
    return "";
  }

  function setPendingFile(file) {
    const problem = validatePdfFile(file);
    if (problem) {
      showResumeAddError(problem);
      return;
    }
    hideResumeAddError();
    state.resumes.pendingFile = file;
    pdfFileName.textContent = file.name + " · " + formatBytes(file.size);
    pdfFileChip.hidden = false;
  }

  function clearPendingFile() {
    state.resumes.pendingFile = null;
    pdfFileName.textContent = "";
    pdfFileChip.hidden = true;
    pdfFileInput.value = "";
  }

  async function handleResumeAdd(event) {
    event.preventDefault();
    hideResumeAddError();
    resumeAddWarnings.hidden = true;

    const mode = state.resumes.addMode;
    const isVersion = mode.type === "version" && mode.resumeId;
    const isPdf = resumeTabs.current === 1;
    const provider = resumeProviderSelect.value;
    const model = resumeModelInput.value.trim();
    const name = resumeNameInput.value.trim();

    let path;
    let body;
    let formData = null;

    if (isPdf) {
      const file = state.resumes.pendingFile;
      const problem = validatePdfFile(file);
      if (problem) {
        showResumeAddError(problem);
        return;
      }
      formData = new FormData();
      formData.append("file", file, file.name);
      if (!isVersion && name) {
        formData.append("name", name);
      }
      if (provider) {
        formData.append("provider", provider);
      }
      if (model) {
        formData.append("model", model);
      }
      path = isVersion
        ? "/api/resumes/" + encodeURIComponent(mode.resumeId) + "/versions/pdf"
        : "/api/resumes/pdf";
    } else {
      const latex = resumeLatexInput.value.trim();
      if (latex.length < resumeLatexMinimum) {
        showResumeAddError("Paste your resume LaTeX first — at least " + resumeLatexMinimum + " characters.");
        resumeLatexInput.focus();
        return;
      }
      if (latex.length > resumeLatexMaximum) {
        showResumeAddError("That LaTeX is too long. Trim it to " + numberFormat.format(resumeLatexMaximum) + " characters or fewer.");
        return;
      }
      body = { latex };
      if (!isVersion && name) {
        body.name = name;
      }
      if (provider) {
        body.provider = provider;
      }
      if (model) {
        body.model = model;
      }
      path = isVersion
        ? "/api/resumes/" + encodeURIComponent(mode.resumeId) + "/versions"
        : "/api/resumes";
    }

    const controller = new AbortController();
    const timeoutToken = startTimeout(controller, REQUEST_TIMEOUT_MS);
    setBusy(resumeAddButton, true, "Importing…");
    resumeAddForm.setAttribute("aria-busy", "true");

    try {
      const payload = await api(path, {
        method: "POST",
        body,
        formData,
        signal: controller.signal,
      });
      const imported = payload.resume || {};
      renderResumeAddWarnings(payload.warnings);
      resumeLatexInput.value = "";
      updateResumeLatexCount();
      clearPendingFile();
      resumeNameInput.value = "";
      if (isVersion) {
        exitVersionMode();
        toast("Imported v" + (imported.version || "?") + " of “" + (imported.name || mode.resumeName) + "”.", "success");
      } else {
        toast("Imported “" + (imported.name || "your resume") + "”.", "success");
      }
      loadResumes();
    } catch (error) {
      if (timeoutToken.timedOut) {
        showResumeAddError("The import took longer than three minutes. The server may be waking up — please try once more.");
      } else if (error && error.name === "AbortError") {
        /* Navigated away mid-import; nothing to show. */
      } else {
        showResumeAddError(errorText(error));
      }
    } finally {
      timeoutToken.clear();
      setBusy(resumeAddButton, false);
      resumeAddForm.setAttribute("aria-busy", "false");
    }
  }

  /* ------------------------------------------------------------------ jds */

  const jdContentMaximum = Number(jdContentInput.maxLength) || 20_000;
  const jdContentMinimum = Number(jdContentInput.minLength) || 50;

  async function loadJds() {
    if (state.mode !== "multi_user" || !state.user) {
      return;
    }
    const version = ++state.jds.listVersion;
    jdsLoading.hidden = false;
    jdsError.hidden = true;
    jdsEmpty.hidden = true;
    try {
      const payload = await api("/api/jds");
      if (version !== state.jds.listVersion) {
        return;
      }
      state.jds.items = Array.isArray(payload.jds) ? payload.jds : [];
      renderJdsList();
    } catch (error) {
      if (version !== state.jds.listVersion) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      jdsErrorMessage.textContent = errorText(error, "Could not load your job descriptions.");
      jdsError.hidden = false;
    } finally {
      if (version === state.jds.listVersion) {
        jdsLoading.hidden = true;
      }
    }
  }

  function renderJdsList() {
    const items = state.jds.items;
    jdsCount.textContent = String(items.length);
    jdsEmpty.hidden = items.length > 0;
    jdsList.replaceChildren();
    const fragment = document.createDocumentFragment();
    items.forEach((jd) => {
      fragment.append(buildJdCard(jd));
    });
    jdsList.append(fragment);
  }

  function buildJdCard(jd) {
    const card = el("article", "item-card");

    const head = el("div", "item-head");
    const titleWrap = el("div", "item-title-wrap");
    titleWrap.append(el("h3", "item-title", jd.title));
    const badges = el("div", "badge-row");
    badges.append(el("span", "badge", "v" + jd.version));
    titleWrap.append(badges);
    head.append(titleWrap);
    card.append(head);

    const metaParts = [];
    if (jd.updated_at) {
      metaParts.push("Updated " + formatDate(jd.updated_at));
    }
    if (jd.created_at) {
      metaParts.push("Created " + formatDate(jd.created_at));
    }
    card.append(el("p", "item-meta", metaParts.join(" · ")));
    if (jd.excerpt) {
      card.append(el("p", "item-excerpt", jd.excerpt));
    }

    const actions = el("div", "item-actions");
    const useBtn = smallButton("Use in Tailor", "button--primary");
    const editBtn = smallButton("Edit");
    const historyBtn = smallButton("History");
    const deleteBtn = smallButton("Delete", "button--quiet button--danger-quiet");
    editBtn.setAttribute("aria-expanded", "false");
    historyBtn.setAttribute("aria-expanded", "false");
    actions.append(useBtn, editBtn, historyBtn, deleteBtn);
    card.append(actions);

    const expandArea = el("div");
    card.append(expandArea);
    let openKind = "";

    function closeExpand() {
      openKind = "";
      expandArea.replaceChildren();
      editBtn.setAttribute("aria-expanded", "false");
      historyBtn.setAttribute("aria-expanded", "false");
    }

    function openBox(kind) {
      closeExpand();
      openKind = kind;
      const box = el("div", "expand-box");
      expandArea.append(box);
      return box;
    }

    useBtn.addEventListener("click", () => {
      state.tailor.preselectJdId = jd.id;
      navigate("tailor");
    });

    editBtn.addEventListener("click", async () => {
      if (openKind === "edit") {
        closeExpand();
        return;
      }
      const box = openBox("edit");
      editBtn.setAttribute("aria-expanded", "true");
      box.append(el("p", "list-status", "Loading content…"));
      let detail = state.jds.detailCache.get(jd.id);
      if (!detail) {
        try {
          const payload = await api("/api/jds/" + encodeURIComponent(jd.id));
          detail = payload.jd || {};
          if (detail.id) {
            state.jds.detailCache.set(detail.id, detail);
          }
        } catch (error) {
          if (openKind !== "edit") {
            return;
          }
          box.replaceChildren(el("p", "", errorText(error, "Could not load this JD.")));
          return;
        }
      }
      if (openKind !== "edit") {
        return;
      }

      box.replaceChildren(el("h4", "", "Edit (saves a new version)"));
      const form = el("form", "inline-form");
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "inline-input";
      titleInput.maxLength = 160;
      titleInput.value = detail.title || jd.title || "";
      titleInput.setAttribute("aria-label", "JD title");
      const textarea = document.createElement("textarea");
      textarea.className = "inline-textarea";
      textarea.maxLength = jdContentMaximum;
      textarea.value = detail.content || "";
      textarea.setAttribute("aria-label", "JD content");
      const counter = el("p", "inline-count");
      const updateCounter = () => {
        counter.textContent = numberFormat.format(textarea.value.length) + " / " + numberFormat.format(jdContentMaximum);
      };
      textarea.addEventListener("input", updateCounter);
      updateCounter();
      const actionsRow = el("div", "inline-form-actions");
      const saveBtn = smallButton("Save changes", "button--primary");
      saveBtn.type = "submit";
      const cancelBtn = smallButton("Cancel", "button--quiet");
      cancelBtn.addEventListener("click", closeExpand);
      actionsRow.append(saveBtn, cancelBtn);
      form.append(titleInput, textarea, counter, actionsRow);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const title = titleInput.value.trim();
        const content = textarea.value.trim();
        if (!title || title.length > 160) {
          toast("Titles must be 1–160 characters.", "error");
          titleInput.focus();
          return;
        }
        if (content.length < jdContentMinimum) {
          toast("JD content must be at least " + jdContentMinimum + " characters.", "error");
          textarea.focus();
          return;
        }
        saveBtn.disabled = true;
        try {
          const payload = await api("/api/jds/" + encodeURIComponent(jd.id), {
            method: "PUT",
            body: { title, content },
          });
          const updated = payload.jd || {};
          if (updated.id) {
            state.jds.detailCache.set(updated.id, updated);
          } else {
            state.jds.detailCache.delete(jd.id);
          }
          toast("Saved “" + (updated.title || title) + "” as v" + (updated.version || "?") + ".", "success");
          loadJds();
        } catch (error) {
          toast(errorText(error), "error");
          saveBtn.disabled = false;
        }
      });
      box.append(form);
      titleInput.focus();
    });

    historyBtn.addEventListener("click", async () => {
      if (openKind === "history") {
        closeExpand();
        return;
      }
      const box = openBox("history");
      historyBtn.setAttribute("aria-expanded", "true");
      box.append(el("p", "list-status", "Loading version history…"));
      try {
        const payload = await api("/api/jds/" + encodeURIComponent(jd.id) + "/versions");
        if (openKind !== "history") {
          return;
        }
        const versions = Array.isArray(payload.versions) ? payload.versions : [];
        box.replaceChildren(el("h4", "", "Version history"));
        if (!versions.length) {
          box.append(el("p", "", "No earlier versions — this JD hasn’t been edited yet."));
          return;
        }
        versions.forEach((versionInfo) => {
          const row = el("div", "version-row");
          const main = el("div", "version-row-main");
          main.append(el("strong", "", "v" + versionInfo.version));
          main.append(document.createTextNode(" · " + (versionInfo.title || "")));
          const subParts = [];
          if (versionInfo.excerpt) {
            subParts.push(excerptText(versionInfo.excerpt, 120));
          }
          if (versionInfo.created_at) {
            subParts.push(formatDateTime(versionInfo.created_at));
          }
          main.append(el("span", "version-row-sub", subParts.join(" · ")));
          row.append(main);
          box.append(row);
        });
      } catch (error) {
        if (openKind !== "history") {
          return;
        }
        box.replaceChildren(el("p", "", errorText(error, "Could not load version history.")));
      }
    });

    deleteBtn.addEventListener("click", async () => {
      const confirmed = await openConfirm({
        title: "Delete “" + jd.title + "”?",
        message: "This deletes the JD and its version history. Past tailor runs stay in History.",
        confirmLabel: "Delete JD",
      });
      if (!confirmed) {
        return;
      }
      try {
        await api("/api/jds/" + encodeURIComponent(jd.id), { method: "DELETE" });
        state.jds.detailCache.delete(jd.id);
        toast("Deleted “" + jd.title + "”.", "success");
        loadJds();
      } catch (error) {
        toast(errorText(error), "error");
      }
    });

    return card;
  }

  async function handleJdCreate(event) {
    event.preventDefault();
    hideNotice(jdFormError, jdFormErrorMessage);
    const title = jdTitleInput.value.trim();
    const content = jdContentInput.value.trim();
    if (!title || title.length > 160) {
      showNotice(jdFormError, jdFormErrorMessage, "Add a title (1–160 characters).");
      jdTitleInput.focus();
      return;
    }
    if (content.length < jdContentMinimum) {
      showNotice(jdFormError, jdFormErrorMessage, "JD content must be at least " + jdContentMinimum + " characters.");
      jdContentInput.focus();
      return;
    }
    if (content.length > jdContentMaximum) {
      showNotice(jdFormError, jdFormErrorMessage, "Shorten the JD to " + numberFormat.format(jdContentMaximum) + " characters or fewer.");
      jdContentInput.focus();
      return;
    }
    setBusy(jdCreateButton, true, "Saving…");
    try {
      const payload = await api("/api/jds", { method: "POST", body: { title, content } });
      const jd = payload.jd || {};
      if (jd.id) {
        state.jds.detailCache.set(jd.id, jd);
      }
      jdTitleInput.value = "";
      jdContentInput.value = "";
      updateJdContentCount();
      toast("Saved “" + (jd.title || title) + "”.", "success");
      loadJds();
    } catch (error) {
      showNotice(jdFormError, jdFormErrorMessage, errorText(error));
    } finally {
      setBusy(jdCreateButton, false);
    }
  }

  /* -------------------------------------------------------------- history */

  async function loadHistory() {
    if (state.mode !== "multi_user" || !state.user) {
      return;
    }
    const openRunId = state.history.openRunId;
    state.history.openRunId = "";
    if (openRunId) {
      openRun(openRunId);
      return;
    }
    backToRunList(false);
    const version = ++state.history.listVersion;
    historyLoading.hidden = false;
    historyError.hidden = true;
    historyEmpty.hidden = true;
    try {
      const payload = await api("/api/runs");
      if (version !== state.history.listVersion) {
        return;
      }
      state.history.items = Array.isArray(payload.runs) ? payload.runs : [];
      renderHistoryList();
    } catch (error) {
      if (version !== state.history.listVersion) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      historyErrorMessage.textContent = errorText(error, "Could not load your history.");
      historyError.hidden = false;
    } finally {
      if (version === state.history.listVersion) {
        historyLoading.hidden = true;
      }
    }
  }

  function renderHistoryList() {
    const items = state.history.items;
    historyEmpty.hidden = items.length > 0;
    historyList.replaceChildren();
    const fragment = document.createDocumentFragment();
    items.forEach((run) => {
      fragment.append(buildRunEntry(run));
    });
    historyList.append(fragment);
  }

  function runProviderText(run) {
    if (!run.provider) {
      return "";
    }
    return providerLabel(run.provider) + (run.model ? " · " + run.model : "");
  }

  function buildRunEntry(run) {
    const card = el("article", "item-card");

    const head = el("div", "item-head");
    const titleWrap = el("div", "item-title-wrap");
    titleWrap.append(el("h3", "item-title", run.jd_title || excerptText(run.jd_excerpt, 60) || "Tailor run"));
    const badges = el("div", "badge-row");
    const pages = Number(run.page_count);
    if (Number.isFinite(pages) && pages > 0) {
      badges.append(el("span", "badge", pages + (pages === 1 ? " page" : " pages")));
    }
    if (run.repaired) {
      badges.append(el("span", "badge badge--repaired", "Repaired"));
    }
    titleWrap.append(badges);
    head.append(titleWrap);
    card.append(head);

    const metaParts = [
      formatDateTime(run.created_at),
      run.resume_name ? run.resume_name + " (v" + run.resume_version + ")" : "",
      runProviderText(run),
    ].filter(Boolean);
    card.append(el("p", "item-meta", metaParts.join(" · ")));
    if (!run.jd_title && run.jd_excerpt) {
      card.append(el("p", "item-excerpt", excerptText(run.jd_excerpt, 160)));
    }

    const actions = el("div", "item-actions");
    const viewBtn = smallButton("View details", "button--primary");
    viewBtn.addEventListener("click", () => {
      openRun(run.id);
    });
    const deleteBtn = smallButton("Delete", "button--quiet button--danger-quiet");
    deleteBtn.addEventListener("click", () => {
      deleteRun(run.id, false);
    });
    actions.append(viewBtn, deleteBtn);
    card.append(actions);

    return card;
  }

  function releaseRunAssets() {
    if (state.history.pdfUrl) {
      URL.revokeObjectURL(state.history.pdfUrl);
      state.history.pdfUrl = null;
    }
    if (state.history.texUrl) {
      URL.revokeObjectURL(state.history.texUrl);
      state.history.texUrl = null;
    }
    runPdfPreview.removeAttribute("src");
    runPdfPreview.hidden = true;
    runPdfEmpty.hidden = false;
    runPdfDownload.hidden = true;
    runPdfDownload.removeAttribute("href");
    runTexDownload.hidden = true;
    runTexDownload.removeAttribute("href");
  }

  async function openRun(runId) {
    const version = ++state.history.detailVersion;
    state.history.currentRun = null;
    historyListWrap.hidden = true;
    runDetail.hidden = false;
    runDetailBody.hidden = true;
    hideNotice(runError, runErrorMessage);
    runWarnings.hidden = true;
    runLoading.hidden = false;
    runDetailMeta.replaceChildren();
    releaseRunAssets();
    runCompileButton.disabled = true;
    runDetail.focus({ preventScroll: true });
    try {
      const payload = await api("/api/runs/" + encodeURIComponent(runId));
      if (version !== state.history.detailVersion) {
        return;
      }
      const run = payload.run || {};
      state.history.currentRun = run;
      renderRunDetail(run);
    } catch (error) {
      if (version !== state.history.detailVersion) {
        return;
      }
      showNotice(runError, runErrorMessage, errorText(error, "Could not load this run."), false);
    } finally {
      if (version === state.history.detailVersion) {
        runLoading.hidden = true;
      }
    }
  }

  function renderRunDetail(run) {
    runDetailMeta.replaceChildren();
    const metaParts = [
      formatDateTime(run.created_at),
      run.resume_name ? run.resume_name + " (v" + run.resume_version + ")" : "",
      run.jd_title || excerptText(run.jd_excerpt, 80),
      runProviderText(run),
    ].filter(Boolean);
    metaParts.forEach((part, index) => {
      if (index > 0) {
        const dot = el("span", "", "·");
        dot.setAttribute("aria-hidden", "true");
        runDetailMeta.append(dot);
      }
      runDetailMeta.append(el("span", "", part));
    });
    if (run.repaired) {
      runDetailMeta.append(el("span", "badge badge--repaired", "Repaired"));
    }

    renderChangesInto(runChangesList, runChangeCount, normalizeChanges(run.changes));
    renderWarningsInto(runWarnings, runWarningsList, normalizeWarnings(run.warnings));
    runDiff.textContent = readableValue(run.unified_diff) || "No diff was recorded for this run.";

    const latexSource = readableValue(run.latex_source);
    if (latexSource) {
      const texBlob = new Blob([latexSource], { type: "text/plain;charset=utf-8" });
      state.history.texUrl = URL.createObjectURL(texBlob);
      runTexDownload.href = state.history.texUrl;
      runTexDownload.download = slugify(run.resume_name || "tailored-resume") + "-run.tex";
      runTexDownload.hidden = false;
      runCompileButton.disabled = false;
    } else {
      runTexDownload.hidden = true;
      runCompileButton.disabled = true;
    }
    runDetailBody.hidden = false;
  }

  async function handleRunCompile() {
    const run = state.history.currentRun;
    if (!run || !run.id) {
      return;
    }
    hideNotice(runError, runErrorMessage);
    const controller = new AbortController();
    const timeoutToken = startTimeout(controller, REQUEST_TIMEOUT_MS);
    setBusy(runCompileButton, true, "Compiling…");
    try {
      const payload = await api("/api/runs/" + encodeURIComponent(run.id) + "/compile", {
        method: "POST",
        signal: controller.signal,
      });
      if (state.history.currentRun !== run) {
        return;
      }
      const pdfBase64 = readableValue(payload.pdf_base64).trim();
      const blob = pdfBase64 ? base64ToPdfBlob(pdfBase64) : null;
      if (!blob) {
        showNotice(runError, runErrorMessage, "The server compiled the run but returned no PDF.");
        return;
      }
      if (state.history.pdfUrl) {
        URL.revokeObjectURL(state.history.pdfUrl);
      }
      state.history.pdfUrl = URL.createObjectURL(blob);
      runPdfPreview.src = state.history.pdfUrl + "#view=FitH";
      runPdfPreview.hidden = false;
      runPdfEmpty.hidden = true;
      runPdfDownload.href = state.history.pdfUrl;
      runPdfDownload.download = sanitizeFilename(payload.filename);
      runPdfDownload.hidden = false;
      const pages = Number(payload.page_count);
      toast(
        Number.isFinite(pages) && pages > 0
          ? "Compiled — " + pages + (pages === 1 ? " page." : " pages.")
          : "Compiled.",
        "success"
      );
    } catch (error) {
      if (state.history.currentRun !== run) {
        return;
      }
      if (timeoutToken.timedOut) {
        showNotice(runError, runErrorMessage, "Compiling took too long. Please try again in a moment.");
      } else if (error && error.name === "AbortError") {
        /* Superseded; ignore. */
      } else {
        showNotice(runError, runErrorMessage, errorText(error));
      }
    } finally {
      timeoutToken.clear();
      setBusy(runCompileButton, false);
      if (!state.history.currentRun || !readableValue(state.history.currentRun.latex_source)) {
        runCompileButton.disabled = true;
      }
    }
  }

  async function deleteRun(runId, fromDetail) {
    const confirmed = await openConfirm({
      title: "Delete this run?",
      message: "This removes the saved changes, diff, and LaTeX for this tailor run.",
      confirmLabel: "Delete run",
    });
    if (!confirmed) {
      return;
    }
    try {
      await api("/api/runs/" + encodeURIComponent(runId), { method: "DELETE" });
      toast("Run deleted.", "success");
      if (fromDetail) {
        backToRunList(true);
      }
      loadHistory();
    } catch (error) {
      toast(errorText(error), "error");
    }
  }

  function backToRunList(focusTitle) {
    state.history.detailVersion += 1;
    state.history.currentRun = null;
    releaseRunAssets();
    runDetail.hidden = true;
    historyListWrap.hidden = false;
    if (focusTitle) {
      viewTitles.history.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  /* ------------------------------------------------------------- settings */

  async function loadSettings() {
    if (state.mode !== "multi_user" || !state.user) {
      return;
    }
    const version = ++state.settings.loadVersion;
    settingsLoading.hidden = false;
    settingsError.hidden = true;
    settingsBody.hidden = true;
    try {
      const [providers, keysPayload, mePayload] = await Promise.all([
        ensureProviders(),
        api("/api/keys"),
        api("/api/me"),
      ]);
      if (version !== state.settings.loadVersion) {
        return;
      }
      if (mePayload && mePayload.user) {
        state.user = mePayload.user;
        updateChrome();
      }
      const keys = Array.isArray(keysPayload.keys) ? keysPayload.keys : [];
      renderSettings(providers, keys);
      settingsBody.hidden = false;
    } catch (error) {
      if (version !== state.settings.loadVersion) {
        return;
      }
      if (error && error.name === "AbortError") {
        return;
      }
      settingsErrorMessage.textContent = errorText(error, "Could not load your settings.");
      settingsError.hidden = false;
    } finally {
      if (version === state.settings.loadVersion) {
        settingsLoading.hidden = true;
      }
    }
  }

  function setKeyHint(hintEl, hint, updatedAt) {
    if (hint) {
      const parts = ["Saved · " + hint];
      if (updatedAt) {
        parts.push("updated " + formatDate(updatedAt));
      }
      hintEl.textContent = parts.join(" · ");
      hintEl.classList.add("is-set");
    } else {
      hintEl.textContent = "Not set";
      hintEl.classList.remove("is-set");
    }
  }

  function addUserKeyedProvider(providerId) {
    if (!state.user) {
      return;
    }
    if (!Array.isArray(state.user.providers_with_keys)) {
      state.user.providers_with_keys = [];
    }
    if (!state.user.providers_with_keys.includes(providerId)) {
      state.user.providers_with_keys.push(providerId);
    }
  }

  function removeUserKeyedProvider(providerId) {
    if (!state.user || !Array.isArray(state.user.providers_with_keys)) {
      return;
    }
    state.user.providers_with_keys = state.user.providers_with_keys.filter((id) => id !== providerId);
  }

  function buildKeyRow(provider, existing) {
    const row = el("div", "key-row");
    const label = provider.label || provider.id;

    const ident = el("div", "key-ident");
    ident.append(el("span", "key-label", label));
    const hintEl = el("span", "key-hint");
    setKeyHint(hintEl, existing ? existing.hint : "", existing ? existing.updated_at : "");
    ident.append(hintEl);

    const input = document.createElement("input");
    input.type = "password";
    input.className = "key-input";
    input.placeholder = existing ? "Replace key" : "Paste API key";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", label + " API key");

    const actions = el("div", "key-actions");
    const saveBtn = smallButton("Save", "button--primary");
    const removeBtn = smallButton("Remove", "button--quiet button--danger-quiet");
    removeBtn.hidden = !existing;
    actions.append(saveBtn, removeBtn);

    saveBtn.addEventListener("click", async () => {
      const value = input.value.trim();
      if (value.length < 8 || value.length > 400) {
        toast("API keys are 8–400 characters.", "error");
        input.focus();
        return;
      }
      saveBtn.disabled = true;
      try {
        const payload = await api("/api/keys/" + encodeURIComponent(provider.id), {
          method: "PUT",
          body: { api_key: value },
        });
        input.value = "";
        input.placeholder = "Replace key";
        setKeyHint(hintEl, payload.hint || "", new Date().toISOString());
        removeBtn.hidden = false;
        addUserKeyedProvider(provider.id);
        toast("Saved your " + label + " key.", "success");
      } catch (error) {
        toast(errorText(error), "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    removeBtn.addEventListener("click", async () => {
      const confirmed = await openConfirm({
        title: "Remove your " + label + " key?",
        message: "Tailoring with " + label + " will stop working until you add a new key.",
        confirmLabel: "Remove key",
      });
      if (!confirmed) {
        return;
      }
      try {
        await api("/api/keys/" + encodeURIComponent(provider.id), { method: "DELETE" });
        setKeyHint(hintEl, "", "");
        removeBtn.hidden = true;
        input.placeholder = "Paste API key";
        removeUserKeyedProvider(provider.id);
        toast("Removed your " + label + " key.", "success");
      } catch (error) {
        toast(errorText(error), "error");
      }
    });

    row.append(ident, input, actions);
    return row;
  }

  function renderSettings(providers, keys) {
    const keysByProvider = {};
    keys.forEach((key) => {
      if (key && key.provider) {
        keysByProvider[key.provider] = key;
      }
    });

    keysList.replaceChildren();
    const keyable = (providers || []).filter((provider) => provider && provider.needs_key);
    if (!keyable.length) {
      keysList.append(el("p", "list-status", "No key-based providers are available on this server."));
    } else {
      keyable.forEach((provider) => {
        keysList.append(buildKeyRow(provider, keysByProvider[provider.id]));
      });
    }

    defaultProviderSelect.replaceChildren();
    defaultProviderSelect.append(new Option("No default", ""));
    (providers || []).forEach((provider) => {
      if (provider && provider.id) {
        defaultProviderSelect.append(new Option(provider.label || provider.id, provider.id));
      }
    });
    const user = state.user || {};
    const values = Array.from(defaultProviderSelect.options).map((option) => option.value);
    defaultProviderSelect.value = user.default_provider && values.includes(user.default_provider)
      ? user.default_provider
      : "";
    defaultModelInput.value = user.default_model || "";

    accountEmail.value = user.email || "";
    accountNameInput.value = user.name || "";
  }

  async function handleDefaultsSave(event) {
    event.preventDefault();
    hideNotice(defaultsError, defaultsErrorMessage);
    const provider = defaultProviderSelect.value || null;
    const model = defaultModelInput.value.trim() || null;
    setBusy(defaultsSaveButton, true, "Saving…");
    try {
      const payload = await api("/api/me", {
        method: "PATCH",
        body: { default_provider: provider, default_model: model },
      });
      if (payload && payload.user) {
        state.user = payload.user;
        updateChrome();
      }
      toast("Defaults saved.", "success");
    } catch (error) {
      showNotice(defaultsError, defaultsErrorMessage, errorText(error));
    } finally {
      setBusy(defaultsSaveButton, false);
    }
  }

  async function handleAccountSave(event) {
    event.preventDefault();
    hideNotice(accountError, accountErrorMessage);
    const name = accountNameInput.value.trim();
    if (name.length > 120) {
      showNotice(accountError, accountErrorMessage, "Names must be 120 characters or fewer.");
      accountNameInput.focus();
      return;
    }
    setBusy(accountSaveButton, true, "Saving…");
    try {
      const payload = await api("/api/me", { method: "PATCH", body: { name } });
      if (payload && payload.user) {
        state.user = payload.user;
        updateChrome();
      }
      toast("Account updated.", "success");
    } catch (error) {
      showNotice(accountError, accountErrorMessage, errorText(error));
    } finally {
      setBusy(accountSaveButton, false);
    }
  }

  async function handleDeleteAccount(event) {
    event.preventDefault();
    hideNotice(deleteAccountError, deleteAccountErrorMessage);
    const password = deletePasswordInput.value;
    if (!password) {
      showNotice(deleteAccountError, deleteAccountErrorMessage, "Enter your password to confirm.");
      deletePasswordInput.focus();
      return;
    }
    setBusy(deleteAccountConfirm, true, "Deleting…");
    try {
      await api("/api/me", { method: "DELETE", body: { password } });
      closeDeleteAccountModal();
      state.user = null;
      clearUserCaches();
      updateChrome();
      navigate("auth");
      toast("Your account was deleted.", "success");
    } catch (error) {
      const message = error instanceof ApiError && error.code === "invalid_credentials"
        ? "That password is incorrect."
        : errorText(error);
      showNotice(deleteAccountError, deleteAccountErrorMessage, message);
    } finally {
      setBusy(deleteAccountConfirm, false);
    }
  }

  /* --------------------------------------------------------------- wiring */

  const updateJdCharacterCount = bindCounter(jobDescription, characterCount, jdMaximumCharacters);
  const updateResumeLatexCount = bindCounter(resumeLatexInput, resumeLatexCount, resumeLatexMaximum);
  const updateJdContentCount = bindCounter(jdContentInput, jdContentCount, jdContentMaximum);

  bootRetry.addEventListener("click", boot);
  logoutButton.addEventListener("click", handleLogout);
  settingsLogoutButton.addEventListener("click", handleLogout);
  window.addEventListener("hashchange", handleRoute);

  loginForm.addEventListener("submit", handleLogin);
  registerForm.addEventListener("submit", handleRegister);

  tailorForm.addEventListener("submit", handleTailorSubmit);
  resetButton.addEventListener("click", () => resetWorkspace());
  startOverButton.addEventListener("click", () => resetWorkspace());
  tailorLoadRetry.addEventListener("click", loadTailorData);
  tailorJdSelect.addEventListener("change", () => loadJdPreview(tailorJdSelect.value));
  saveJdCheckbox.addEventListener("change", () => {
    saveJdTitle.hidden = !saveJdCheckbox.checked;
    if (saveJdCheckbox.checked) {
      saveJdTitle.focus();
    }
  });
  runLink.addEventListener("click", () => {
    state.history.openRunId = state.tailor.lastRunId;
  });

  resumeAddForm.addEventListener("submit", handleResumeAdd);
  resumeAddCancel.addEventListener("click", exitVersionMode);
  resumesRetry.addEventListener("click", loadResumes);
  pdfBrowseButton.addEventListener("click", () => pdfFileInput.click());
  pdfFileInput.addEventListener("change", () => {
    if (pdfFileInput.files && pdfFileInput.files[0]) {
      setPendingFile(pdfFileInput.files[0]);
    }
    pdfFileInput.value = "";
  });
  pdfFileClear.addEventListener("click", clearPendingFile);
  ["dragenter", "dragover"].forEach((eventName) => {
    pdfDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      pdfDropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    pdfDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      pdfDropzone.classList.remove("is-dragover");
    });
  });
  pdfDropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      setPendingFile(file);
    }
  });

  jdForm.addEventListener("submit", handleJdCreate);
  jdsRetry.addEventListener("click", loadJds);

  historyRetry.addEventListener("click", loadHistory);
  runBackButton.addEventListener("click", () => {
    backToRunList(true);
    loadHistory();
  });
  runCompileButton.addEventListener("click", handleRunCompile);
  runDeleteButton.addEventListener("click", () => {
    if (state.history.currentRun && state.history.currentRun.id) {
      deleteRun(state.history.currentRun.id, true);
    }
  });

  settingsRetry.addEventListener("click", loadSettings);
  defaultsForm.addEventListener("submit", handleDefaultsSave);
  accountForm.addEventListener("submit", handleAccountSave);
  deleteAccountButton.addEventListener("click", openDeleteAccountModal);
  deleteAccountForm.addEventListener("submit", handleDeleteAccount);
  deleteAccountCancel.addEventListener("click", closeDeleteAccountModal);

  confirmModalCancel.addEventListener("click", () => closeConfirm(false));
  confirmModalConfirm.addEventListener("click", () => closeConfirm(true));
  confirmModalRoot.addEventListener("click", (event) => {
    if (event.target === confirmModalRoot) {
      closeConfirm(false);
    }
  });
  confirmModalRoot.addEventListener("keydown", (event) => trapModalTab(event, confirmModalRoot));
  deleteAccountModal.addEventListener("click", (event) => {
    if (event.target === deleteAccountModal) {
      closeDeleteAccountModal();
    }
  });
  deleteAccountModal.addEventListener("keydown", (event) => trapModalTab(event, deleteAccountModal));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!confirmModalRoot.hidden) {
      closeConfirm(false);
    } else if (!deleteAccountModal.hidden) {
      closeDeleteAccountModal();
    }
  });

  window.addEventListener("beforeunload", () => {
    clearGeneratedFiles();
    releaseRunAssets();
  });

  // authTabs is only exercised through the click/keyboard handlers that
  // setupTabs registers internally; referencing it documents that on purpose.
  void authTabs;

  boot();
})();
