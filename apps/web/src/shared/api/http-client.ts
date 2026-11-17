import { ApiError, type ProblemDetails } from "./problem-details";

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export type ApiClient = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asProblemDetails(value: unknown): ProblemDetails | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as ProblemDetails;
}

export function createApiClient(baseUrl = "", fetcher: typeof fetch = fetch): ApiClient {
  return {
    async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
      const { body, headers: suppliedHeaders, ...requestOptions } = options;
      const headers = new Headers(suppliedHeaders);
      headers.set("Accept", "application/json");

      let requestBody: BodyInit | undefined;
      if (body !== undefined) {
        headers.set("Content-Type", "application/json");
        requestBody = JSON.stringify(body);
      }

      const response = await fetcher(buildUrl(baseUrl, path), {
        ...requestOptions,
        headers,
        body: requestBody,
        credentials: requestOptions.credentials ?? "include",
      });
      const payload = await readResponseBody(response);

      if (!response.ok) {
        const problem = asProblemDetails(payload);
        throw new ApiError(
          response.status,
          problem,
          typeof payload === "string" ? payload : undefined,
        );
      }

      return payload as T;
    },
  };
}

const configuredBaseUrl = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env?.VITE_API_BASE_URL ?? "";

export const apiClient = createApiClient(configuredBaseUrl);
