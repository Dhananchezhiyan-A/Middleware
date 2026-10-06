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

export interface ImportCsvJob extends JobBase {
  importJobId: string;
  createdBy: string;
}

/** Payload actually dispatched to a destination adapter (snapshot in memory). */
export interface DeliveryPayload {
  canonical: CanonicalLead;
  mapped: Record<string, unknown>;
}
