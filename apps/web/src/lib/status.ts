import type { DeliveryStatus, LeadStage, LeadStatus } from "@middleware/types";
import type { BadgeProps } from "@/components/ui/badge";

type Variant = BadgeProps["variant"];

export const leadStatusVariant: Record<LeadStatus, Variant> = {
  RECEIVED: "info",
  PROCESSING: "warning",
  PROCESSED: "success",
  REJECTED: "secondary",
  FAILED: "danger",
};

export const stageVariant: Record<LeadStage, Variant> = {
  RECEIVED: "info",
  VALIDATION: "info",
  NORMALIZATION: "info",
  DEDUPLICATION: "purple",
  ENRICHMENT: "purple",
  SCORING: "purple",
  ROUTING: "info",
  MAPPING: "info",
  QUEUED: "warning",
  DELIVERY: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

export const deliveryStatusVariant: Record<DeliveryStatus, Variant> = {
  PENDING: "secondary",
  QUEUED: "info",
  IN_PROGRESS: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  DEAD: "danger",
  SKIPPED: "secondary",
};

/** Destination health pill: CONNECTED / DISCONNECTED / ERROR / NOT_CONFIGURED. */
export function healthVariant(status: string | undefined | null): Variant {
  switch (status) {
    case "CONNECTED":
      return "success";
    case "DISCONNECTED":
      return "warning";
    case "ERROR":
      return "danger";
    case "NOT_CONFIGURED":
      return "secondary";
    default:
      return "outline";
  }
}

export function stageStatusVariant(status: string): Variant {
  switch (status) {
    case "PASSED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "warning";
    case "SKIPPED":
      return "secondary";
    default:
      return "outline";
  }
}
