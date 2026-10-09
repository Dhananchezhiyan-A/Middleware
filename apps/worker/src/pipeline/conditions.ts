/**
 * Condition evaluation for the SCORING and ROUTING stages.
 *
 * The engine lives in `@middleware/integrations` so the API's routing PREVIEW
 * endpoint and the worker evaluate rules with exactly the same code. This
 * module re-exports that surface under the pipeline's historical import path —
 * no call site (or spec) needs to change.
 */
export {
  combineClauses,
  evaluateCondition,
  evaluateConditions,
  evaluateDateCondition,
  evaluateRuleClauses,
  evaluateRuleConditions,
  evaluateRouting,
  evaluateTimeCondition,
  isInternalMiddlewareFallback,
  isValidTimeZone,
  parseConditions,
  parseRuleConditions,
  resolveConditionField,
  zonedParts,
} from "@middleware/integrations";
export type {
  ConditionContext,
  DateCondition,
  EvaluatedRule,
  RuleClause,
  RuleCondition,
  RuleConditions,
  RoutingDestinationInput,
  RoutingEvaluation,
  RoutingFallback,
  RoutingRuleInput,
  TimeCondition,
} from "@middleware/integrations";
