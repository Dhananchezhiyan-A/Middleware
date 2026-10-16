import { AdapterRegistry } from "./registry";
import { CustomApiAdapter } from "./adapters/custom-api";
import { DctCrmAdapter } from "./adapters/dct-crm";
import { HubSpotAdapter } from "./adapters/hubspot";
import { PipedriveAdapter } from "./adapters/pipedrive";
import { SalesforceAdapter } from "./adapters/salesforce";
import { WebhookAdapter } from "./adapters/webhook";
import { ZohoAdapter } from "./adapters/zoho";

export * from "./types";
export * from "./registry";
export * from "./mapping";
export * from "./default-payload";
export * from "./conditions";
export * from "./http";
export {
  CustomApiAdapter,
  DctCrmAdapter,
  HubSpotAdapter,
  PipedriveAdapter,
  SalesforceAdapter,
  WebhookAdapter,
  ZohoAdapter,
};

/**
 * Builds a registry with every production adapter.
 *
 * These are REAL integrations — none of them fakes success. When credentials
 * or configuration are absent they report DESTINATION_NOT_CONFIGURED and the
 * delivery is recorded as failed with that exact reason.
 */
export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register(new SalesforceAdapter())
    .register(new ZohoAdapter())
    .register(new DctCrmAdapter())
    .register(new HubSpotAdapter())
    .register(new PipedriveAdapter())
    .register(new CustomApiAdapter())
    .register(new WebhookAdapter());
}
