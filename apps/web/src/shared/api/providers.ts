/**
 * SSO Provider Configuration and API
 *
 * TODO: Replace with dynamic API call to GET /api/v1/auth/providers
 * when backend implements provider configuration endpoint.
 *
 * Current implementation uses static configuration with availability checks.
 */

export interface SSOProvider {
  id: string;
  name: string;
  loginUrl: string;
  enabled: boolean;
}

/**
 * Static SSO provider configuration.
 * In production, this should be replaced with a backend API call.
 */
const CONFIGURED_PROVIDERS: SSOProvider[] = [
  {
    id: "oidc",
    name: "SSO",
    loginUrl: "/auth/oidc/login",
    enabled: true,
  },
  // Future providers can be added here:
  // {
  //   id: "github",
  //   name: "GitHub",
  //   loginUrl: "/auth/oidc/login?provider=github",
  //   enabled: true,
  // },
];

/**
 * Fetch available SSO providers.
 *
 * Currently returns static configuration filtered by enabled flag.
 * When backend API is available, this should make a GET request to /api/v1/auth/providers.
 */
export async function getEnabledProviders(): Promise<SSOProvider[]> {
  // TODO: Replace with actual API call when backend endpoint exists
  // const response = await fetch("/api/v1/auth/providers", { credentials: "include" });
  // if (!response.ok) {
  //   throw new Error("Failed to fetch SSO providers");
  // }
  // return response.json();

  // For now, return configured providers that are enabled
  return CONFIGURED_PROVIDERS.filter((p) => p.enabled);
}

/**
 * Check if a specific provider is available by testing its login URL.
 * This is a temporary solution until backend provides provider status.
 */
export async function checkProviderAvailability(
  provider: SSOProvider
): Promise<boolean> {
  try {
    // Try HEAD request first (lighter)
    const response = await fetch(provider.loginUrl, {
      method: "HEAD",
      credentials: "include",
      redirect: "manual", // Don't follow redirects
    });

    // 200 OK or 302 redirect means the endpoint exists
    return response.status === 200 || response.status === 302;
  } catch {
    // Network error or CORS issue - assume available for now
    return true;
  }
}
