import {
  BriefcaseIcon,
  FileTextIcon,
  HistoryIcon,
  SettingsIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The application's navigation, declared once.
 *
 * The sidebar, the mobile drawer and the demo-mode gating all read this array,
 * so adding a route means editing one place. Keep it ordered the way the work
 * flows: tailor first, the things you tailor from next, the record of what you
 * tailored after that, configuration last.
 */
export interface NavItem {
  /** Written without a trailing slash; `trailingSlash: true` adds it. */
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile drawer and as the disabled-item tooltip subject. */
  description: string;
  /**
   * True when the route is meaningless without a database.
   *
   * In `demo` mode the server has no storage at all (GET /api/health -> mode),
   * so these are rendered disabled with an explanation rather than hidden —
   * hiding them would misrepresent what the product does.
   */
  requiresStorage: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Tailor",
    icon: SparklesIcon,
    description: "Match a resume to a job description and review every change.",
    requiresStorage: false,
  },
  {
    href: "/resumes",
    label: "Resumes",
    icon: FileTextIcon,
    description: "Your saved resumes and their versions.",
    requiresStorage: true,
  },
  {
    href: "/jds",
    label: "Job descriptions",
    icon: BriefcaseIcon,
    description: "Job descriptions you have saved to tailor against.",
    requiresStorage: true,
  },
  {
    href: "/history",
    label: "History",
    icon: HistoryIcon,
    description: "Past tailoring runs, their diffs and their PDFs.",
    requiresStorage: true,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    // Available in both modes: even without a database there is a provider,
    // a model, a theme and a server to inspect.
    description: "Provider keys, account and appearance.",
    requiresStorage: false,
  },
] as const;

/**
 * Strip the trailing slash `next.config.ts` adds so hrefs and pathnames can be
 * compared. `usePathname()` reports "/resumes/" while NAV_ITEMS declares
 * "/resumes"; without this every item would look inactive.
 */
export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * Whether `href` is the section the user is currently in.
 *
 * "/" matches only itself — a prefix match would light up Tailor on every
 * page. Everything else matches its own subtree, so a future /resumes/new
 * still shows Resumes as active.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}
