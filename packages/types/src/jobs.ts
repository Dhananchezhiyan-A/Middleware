import type { CanonicalLead } from "./lead";

/**
 * Queue job payloads — the explicit contract between the API (producer) and
 * the worker (consumer). Every job carries a correlationId so a lead can be
 * traced end-to-end (request → stages → delivery → CRM response).
 */

export interface JobBase {
  correlationId: string;
}

export interface LeadIntakeJob extends JobBase {
  leadId: string;
  webhookEventId?: string;
}

export interface LeadProcessingJob extends JobBase {
  leadId: string;
}

export interface EnrichLeadJob extends JobBase {
  leadId: string;
}

export interface ScoreLeadJob extends JobBase {
  leadId: string;
  scoringRuleSetVersion?: string;
}

export interface RouteLeadJob extends JobBase {
  leadId: string;
}

export interface DeliverJob extends JobBase {
  deliveryId: string;
  leadId: string;
  destinationId: string;
}

export interface ReplayDeliveryJob extends JobBase {
  deliveryId: string;
  /** Who requested the replay (for audit). */
  requestedBy: string;
}

/**
 * One CSV column → one canonical lead field.
 *
 * `target` is a canonical path (a `LEAD_FIELDS` key such as `email`,
 * `name.first`, `custom.<anything>`) or `""` to skip the column entirely.
 * Absent mapping entries fall back to header-alias detection, so an import
 * created before column mapping still behaves identically.
 */
export interface CsvColumnMapping {
  /** CSV header text exactly as it appears in the file. */
  column: string;
  /** Canonical lead field this column feeds ("" = ignore the column). */
  target: string;
}

export interface ImportCsvJob extends JobBase {
  importJobId: string;
  createdBy: string;
  /** User-confirmed column mapping chosen in the upload UI. */
  mapping?: CsvColumnMapping[];
}

/** Payload actually dispatched to a destination adapter (snapshot in memory). */
export interface DeliveryPayload {
  canonical: CanonicalLead;
  mapped: Record<string, unknown>;
}
