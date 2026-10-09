import {
  Activity,
  BarChart3,
  Boxes,
  Braces,
  Cable,
  ClipboardList,
  Database,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Plug,
  Repeat2,
  Route,
  Scale,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export interface NavLink {
  label: string;
  href: string;
  icon: LucideIcon;
  /** UX-only gate — the API enforces permissions server-side. */
  permission?: string;
}

export interface NavSection {
  title: string;
  links: NavLink[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "",
    links: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "analytics:read" }],
  },
  {
    title: "Leads",
    links: [
      { label: "All Leads", href: "/leads", icon: Database, permission: "leads:read" },
      { label: "Processing", href: "/leads/processing", icon: Activity, permission: "leads:read" },
      { label: "Delivered", href: "/leads/delivered", icon: Send, permission: "leads:read" },
      { label: "Failed", href: "/leads/failed", icon: Gauge, permission: "leads:read" },
      { label: "Duplicates", href: "/leads/duplicates", icon: Scale, permission: "leads:read" },
    ],
  },
  {
    title: "Integrations",
    links: [
      { label: "Sources", href: "/sources", icon: Webhook, permission: "sources:read" },
      { label: "Webhook Events", href: "/webhooks/events", icon: Inbox, permission: "sources:read" },
      { label: "Destinations", href: "/destinations", icon: Plug, permission: "destinations:read" },
    ],
  },
  {
    title: "Automation",
    links: [
      { label: "Routing Rules", href: "/automation/routing-rules", icon: Route, permission: "routing:read" },
      { label: "Field Mapping", href: "/automation/field-mappings", icon: Tags, permission: "mappings:read" },
      { label: "Scoring", href: "/automation/scoring", icon: ListChecks, permission: "scoring:read" },
      { label: "Deduplication", href: "/automation/deduplication", icon: Braces, permission: "dedup:read" },
      { label: "Enrichment", href: "/automation/enrichment", icon: Sparkles, permission: "enrichment:read" },
    ],
  },
  {
    title: "Delivery",
    links: [
      { label: "Queue", href: "/delivery/queue", icon: Boxes, permission: "deliveries:read" },
      { label: "Successful", href: "/delivery/successful", icon: Cable, permission: "deliveries:read" },
      { label: "Failed", href: "/delivery/failed", icon: Repeat2, permission: "deliveries:read" },
      { label: "Retry", href: "/delivery/retry", icon: GitBranch, permission: "deliveries:read" },
      { label: "Dead Letter", href: "/delivery/dead-letter", icon: FileSpreadsheet, permission: "deliveries:read" },
    ],
  },
  {
    title: "",
    links: [{ label: "Analytics", href: "/analytics", icon: BarChart3, permission: "analytics:read" }],
  },
  {
    title: "System",
    links: [
      { label: "Users", href: "/system/users", icon: Users, permission: "users:read" },
      { label: "Roles", href: "/system/roles", icon: ShieldCheck, permission: "roles:read" },
      { label: "API Keys", href: "/system/api-keys", icon: KeyRound, permission: "apikeys:read" },
      { label: "Audit Logs", href: "/system/audit-logs", icon: ClipboardList, permission: "audit:read" },
      { label: "Settings", href: "/system/settings", icon: Settings, permission: "settings:read" },
    ],
  },
];

/** URL segment → breadcrumb label. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  processing: "Processing",
  delivered: "Delivered",
  failed: "Failed",
  duplicates: "Duplicates",
  sources: "Sources",
  webhooks: "Webhooks",
  events: "Webhook Events",
  destinations: "Destinations",
  automation: "Automation",
  "routing-rules": "Routing Rules",
  "field-mappings": "Field Mapping",
  scoring: "Scoring",
  deduplication: "Deduplication",
  enrichment: "Enrichment",
  delivery: "Delivery",
  queue: "Queue",
  successful: "Successful",
  retry: "Retry",
  "dead-letter": "Dead Letter",
  analytics: "Analytics",
  system: "System",
  users: "Users",
  roles: "Roles",
  "api-keys": "API Keys",
  "audit-logs": "Audit Logs",
  settings: "Settings",
};
