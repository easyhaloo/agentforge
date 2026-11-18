// Identity Management API - stub implementation
// TODO: Implement full identity management API client

import { APIError } from "./identity";

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

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    throw new APIError("Identity management API not yet implemented", 501);
  },
};
