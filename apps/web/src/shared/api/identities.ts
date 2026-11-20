// Linked identity management still awaits its client implementation.

import { APIError, request } from "./identity";

export { APIError };

export type Identity = {
  id: string;
  provider?: string;
  provider_display?: string;
  email?: string;
  issuer?: string;
  subject?: string;
  created_at: string;
  last_used_at?: string;
  is_primary?: boolean;
};

export const identityManagementAPI = {
  list: async (): Promise<Identity[]> => {
    throw new APIError("Identity management API not yet implemented", 501);
  },

  setPrimary: async (id: string): Promise<void> => {
    throw new APIError("Identity management API not yet implemented", 501);
  },

  remove: async (id: string): Promise<void> => {
    throw new APIError("Identity management API not yet implemented", 501);
  },

  unlink: async (id: string): Promise<void> => {
    throw new APIError("Identity management API not yet implemented", 501);
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/me/password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
};
