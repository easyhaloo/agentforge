import type { TFunction } from "i18next";

/**
 * The error a failed request raises.
 *
 * The message is the API's own English prose. The interface never shows it: `translateError`
 * picks a translated message from the problem title or status code, so a Chinese user never reads an
 * English sentence from the backend.
 */
export class APIError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string, readonly title?: string) {
    super(message);
    this.name = "APIError";
  }
}

/** The translation key for each status the API answers with. */
export const errorKeyByStatus: Record<number, string> = {
  400: "errors:badRequest",
  401: "errors:unauthorized",
  403: "errors:forbidden",
  404: "errors:notFound",
  405: "errors:methodNotAllowed",
  409: "errors:conflict",
  413: "errors:payloadTooLarge",
  422: "errors:invalidRequest",
  429: "errors:tooManyRequests",
  500: "errors:serverError",
  501: "errors:notImplemented",
  502: "errors:badGateway",
  503: "errors:serviceUnavailable",
  504: "errors:gatewayTimeout",
};

/**
 * The message a failed request shows.
 *
 * A request that reached the API is described by its recognized problem title or status. Other
 * failures fall back to the caller's own message for that action.
 */
export function translateError(cause: unknown, t: TFunction, fallbackKey: string): string {
  if (cause instanceof APIError) {
    if (cause.title === "Repository Actions disabled") return t("errors:repositoryActionsDisabled");
    if (cause.title === "Trigger conflict") return t("errors:duplicateTrigger");
    if (cause.title === "Unresolved pull request conversations") return t("errors:unresolvedPullRequestConversations");
    if (cause.title === "Required workflows pending") return t("errors:requiredWorkflowsPending");
    if (cause.title === "Source branch is behind") return t("errors:strictWorkflowBase");
    if (cause.title === "Invalid required workflows") return t("errors:ineligibleRequiredWorkflow");
    if (cause.title === "Pull request branch has conflicts") return t("pulls:branchUpdate.conflicts");
    if (cause.title === "Pull request branches or policy changed") return t("pulls:branchUpdate.changed");
    if (cause.title === "Pull request revision needs refresh") return t("pulls:branchUpdate.refreshRevision");
    return t(errorKeyByStatus[cause.status] ?? "errors:unknown");
  }
  return t(fallbackKey);
}
