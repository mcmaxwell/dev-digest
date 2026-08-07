import { IntentClassification } from '@devdigest/shared';

/**
 * Structured-output schema for the classifier call. The name doubles as
 * `schemaName` on the LLM call, which is what makes the intent call and the
 * review call distinguishable in the Live Log, the OpenRouter dashboard, and in
 * tests (`MockLLMProvider.structuredBySchema`).
 *
 * It is the SHARED contract, not a module-local copy: what the model returns is
 * exactly what is persisted and rendered, so a second definition could only
 * drift.
 */
export const IntentClassificationSchema = IntentClassification;
export const INTENT_SCHEMA_NAME = 'Intent';
