export const siteConfig = {
  name: "Handover",
  tagline: "The shift-change board for one person you love.",
  description:
    "Handover is a shared care board for one person receiving care. Log doses and observations, run a deterministic handover-readiness check, and seal a brief the next caregiver can act on. Built for the friend who was doing all of this from memory.",
  repository: "aniruddhaadak80/handover",
  repoUrl: "https://github.com/aniruddhaadak80/handover",
  liveUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://handover-olive.vercel.app",
  topics: [
    "caregiving",
    "medication-management",
    "shift-handover",
    "nextjs",
    "mcp",
    "open-source-ai",
    "accessibility",
  ],
} as const;

export type NavItem = { href: string; label: string; short: string };

export const navigation: NavItem[] = [
  { href: "/boards", label: "Care boards", short: "Boards" },
  { href: "/handover", label: "Handover", short: "Handover" },
  { href: "/agent", label: "Agent console", short: "Agent" },
  { href: "/verify", label: "Verify seals", short: "Verify" },
  { href: "/settings", label: "Settings", short: "Settings" },
];

export function absoluteUrl(path: string): string {
  const base = siteConfig.liveUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function repoIssuesUrl(): string {
  return `${siteConfig.repoUrl}/issues`;
}