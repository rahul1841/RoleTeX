/**
 * The job description library.
 *
 * Only the screen is exported. Everything else — the list, the reading pane,
 * the form dialog, the version trail — is an implementation detail of this
 * feature and is reached through it, so the route file imports one thing and
 * nothing outside this directory can grow a dependency on the internals.
 */
export { JdScreen } from "./jd-screen";
