import { CredentialTypes, DestinationTypes } from "@middleware/types";

/**
 * Per-destination configuration hints.
 *
 * These are ADAPTER DOCUMENTATION, not data: they describe which keys the
 * server-side adapters read (packages/integrations). The actual values always
 * come from `destination.config` (API), and the server independently validates
 * them via GET /destinations/types → `requiredConfigKeys`.
 */

export interface ConfigFieldHint {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Rendered as a select when options exist. */
  options?: string[];
}

export interface DestinationTypeInfoLite {
  type: DestinationTypeValue;
  /** Adapter doc: what the config keys do. */
  fields: ConfigFieldHint[];
  /** Credential types the adapter accepts. */
  credentialTypes: readonly string[];
  /** Credential is mandatory for deliveries to succeed. */
  credentialRequired: boolean;
}

type DestinationTypeValue = (typeof DestinationTypes)[number];

export const DESTINATION_TYPE_INFO: Record<DestinationTypeValue, DestinationTypeInfoLite> = {
  SALESFORCE: {
    type: "SALESFORCE",
    fields: [
      { key: "instanceUrl", label: "Instance URL", hint: "required", placeholder: "https://acme.my.salesforce.com" },
      { key: "sObject", label: "sObject", hint: "default Lead", placeholder: "Lead" },
      { key: "apiVersion", label: "API version", hint: "default v60.0", placeholder: "v60.0" },
      {
        key: "externalIdField",
        label: "External ID field",
        hint: "enables upsert retries",
        placeholder: "External_Id__c",
      },
    ],
    credentialTypes: ["BEARER"],
    credentialRequired: true,
  },
  ZOHO: {
    type: "ZOHO",
    fields: [
      { key: "region", label: "Region", options: ["com", "eu", "in", "au", "jp"] },
      { key: "module", label: "Module", hint: "default Lead", placeholder: "Leads" },
      { key: "apiVersion", label: "API version", placeholder: "v7" },
      { key: "externalIdField", label: "External ID field", hint: "enables upsert retries" },
      { key: "apiDomain", label: "API domain override", hint: "optional" },
    ],
    credentialTypes: ["BEARER"],
    credentialRequired: true,
  },
  DCT_CRM: {
    type: "DCT_CRM",
    fields: [
      { key: "baseUrl", label: "Base URL", hint: "required unless url is set", placeholder: "https://crm.example.com" },
      { key: "createPath", label: "Create path", hint: "default /api/leads", placeholder: "/api/leads" },
      { key: "url", label: "Full URL", hint: "overrides baseUrl + createPath" },
      { key: "authType", label: "Auth type", options: ["bearer", "apikey", "basic", "none"] },
      { key: "apiKeyHeader", label: "API key header", placeholder: "x-api-key" },
      { key: "method", label: "HTTP method", options: ["POST", "PUT", "PATCH"] },
      { key: "idempotencyHeader", label: "Idempotency header", hint: "default Idempotency-Key" },
    ],
    credentialTypes: ["BEARER", "API_KEY", "BASIC"],
    credentialRequired: true,
  },
  HUBSPOT: {
    type: "HUBSPOT",
    fields: [
      { key: "objectType", label: "Object type", hint: "default contacts", placeholder: "contacts" },
      { key: "idProperty", label: "ID property", hint: "for upserts" },
      { key: "apiBaseUrl", label: "API base URL", hint: "default https://api.hubapi.com" },
    ],
    credentialTypes: ["BEARER"],
    credentialRequired: true,
  },
  PIPEDRIVE: {
    type: "PIPEDRIVE",
    fields: [
      { key: "resource", label: "Resource", options: ["persons", "deals", "organizations"] },
      { key: "apiBaseUrl", label: "API base URL", hint: "default https://api.pipedrive.com/v1" },
    ],
    credentialTypes: ["API_KEY"],
    credentialRequired: true,
  },
  CUSTOM_API: {
    type: "CUSTOM_API",
    fields: [
      { key: "url", label: "Endpoint URL", hint: "required", placeholder: "https://example.com/api/leads" },
      { key: "method", label: "HTTP method", options: ["POST", "PUT", "PATCH"] },
      { key: "authType", label: "Auth type", options: ["none", "bearer", "basic", "apikey"] },
      { key: "apiKeyHeader", label: "API key header", placeholder: "x-api-key" },
      { key: "idempotencyHeader", label: "Idempotency header" },
      { key: "timeoutMs", label: "Timeout (ms)" },
    ],
    credentialTypes: ["BEARER", "API_KEY", "BASIC"],
    credentialRequired: false,
  },
  WEBHOOK: {
    type: "WEBHOOK",
    fields: [
      { key: "url", label: "Endpoint URL", hint: "required", placeholder: "https://example.com/webhook" },
      { key: "idempotencyHeader", label: "Idempotency header" },
      { key: "timeoutMs", label: "Timeout (ms)" },
    ],
    credentialTypes: ["WEBHOOK_HMAC"],
    credentialRequired: false,
  },
};

export function typeInfo(type: string | undefined | null): DestinationTypeInfoLite | null {
  if (!type) return null;
  return DESTINATION_TYPE_INFO[type as DestinationTypeValue] ?? null;
}

/** Credential types offered in the credentials dialog for a destination. */
export function credentialOptions(type: string | undefined | null): readonly string[] {
  return typeInfo(type)?.credentialTypes ?? CredentialTypes;
}
