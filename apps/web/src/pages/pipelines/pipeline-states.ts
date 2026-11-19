/**
 * The pipeline states the API reports and the labels the UI shows for them.
 *
 * The pages translate a state with a dynamic key, so the list lives here where the
 * `architecture/i18n-keys.test.ts` check can resolve every one of them.
 */

/** Every run, step and merge queue state the API reports. */
export const pipelineStates = [
  "queued",
  "building",
  "ready",
  "leased",
  "waiting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;

/**
 * The translation key for a pipeline state.
 *
 * A step that is "leased" is one the runner has taken but not started, which the UI shows
 * as "running".
 */
export function pipelineStateKey(state: string): string {
  return state === "leased" ? "running" : state;
}
