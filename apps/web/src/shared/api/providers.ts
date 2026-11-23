const loginURLs = {
  google: "/auth/google/login",
  github: "/auth/github/login",
  oidc: "/auth/oidc/login",
} as const;

export type SSOProviderID = keyof typeof loginURLs;

export interface SSOProvider {
  id: SSOProviderID;
  loginUrl: (typeof loginURLs)[SSOProviderID];
}

export async function getEnabledProviders(signal: AbortSignal): Promise<SSOProvider[]> {
  const response = await fetch("/auth/providers", { signal });
  if (!response.ok) throw new Error("Failed to fetch SSO providers");

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("providers" in result) || !Array.isArray(result.providers)) {
    throw new Error("Invalid SSO provider list");
  }

  const seen = new Set<SSOProviderID>();
  return result.providers.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("id" in entry) || !("login_url" in entry)) {
      throw new Error("Invalid SSO provider");
    }
    const { id, login_url } = entry;
    if (id !== "google" && id !== "github" && id !== "oidc") throw new Error("Unknown SSO provider");
    const loginUrl = loginURLs[id];
    if (login_url !== loginUrl || seen.has(id)) throw new Error("Invalid SSO provider");
    seen.add(id);
    return { id, loginUrl };
  });
}
