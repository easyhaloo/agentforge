import { describe, it, expect, beforeEach } from 'vitest';
import { apiRequest, authenticatedRequest, API_BASE_URL } from '../setup-tests';

describe('User Login', () => {
  // Use fixture users that are loaded by setup.sh
  const FIXTURE_USER = {
    email: 'test@example.com',
    password: 'TestPassword123!',
  };

  const EXISTING_USER = {
    email: 'existing@example.com',
    password: 'ExistingPass456!',
  };

  describe('POST /auth/local/login', () => {
    it('should successfully login with valid credentials', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          password: FIXTURE_USER.password,
        }),
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result).toMatchObject({
        identity_id: expect.any(String),
        email: FIXTURE_USER.email,
        display_name: expect.any(String),
      });

      // Should return a session cookie
      const cookies = response.headers.get('set-cookie');
      expect(cookies).toContain('session=');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('SameSite');
    });

    it('should reject login with incorrect password', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          password: 'WrongPassword123!',
        }),
      });

      expect(response.status).toBe(401);

      const result = await response.json();
      expect(result).toMatchObject({
        error: expect.stringContaining('Invalid'),
      });

      // Should not return a session cookie
      const cookies = response.headers.get('set-cookie');
      expect(cookies).toBeNull();
    });

    it('should reject login with non-existent email', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'AnyPassword123!',
        }),
      });

      expect(response.status).toBe(401);

      const result = await response.json();
      expect(result).toMatchObject({
        error: expect.stringContaining('Invalid'),
      });
    });

    it('should reject login with missing credentials', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          // Missing password
        }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result).toHaveProperty('error');
    });

    it('should handle email case insensitivity', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email.toUpperCase(),
          password: FIXTURE_USER.password,
        }),
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.email).toBe(FIXTURE_USER.email.toLowerCase());
    });

    it('should trim whitespace from email', async () => {
      const response = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: `  ${FIXTURE_USER.email}  `,
          password: FIXTURE_USER.password,
        }),
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.email).toBe(FIXTURE_USER.email.toLowerCase());
    });
  });

  describe('Session Management', () => {
    it('should create a valid session after login', async () => {
      // Login
      const loginResponse = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          password: FIXTURE_USER.password,
        }),
      });

      expect(loginResponse.status).toBe(200);

      // Extract session token from cookie
      const cookies = loginResponse.headers.get('set-cookie') || '';
      const sessionMatch = cookies.match(/session=([^;]+)/);
      expect(sessionMatch).toBeTruthy();

      const sessionToken = sessionMatch![1];

      // Use session to access protected endpoint
      const protectedResponse = await authenticatedRequest(
        '/api/me',
        sessionToken
      );

      expect(protectedResponse.status).toBe(200);

      const userData = await protectedResponse.json();
      expect(userData.email).toBe(FIXTURE_USER.email);
    });

    it('should reject requests with invalid session token', async () => {
      const response = await authenticatedRequest(
        '/api/me',
        'invalid-session-token'
      );

      expect(response.status).toBe(401);
    });

    it('should allow logout with valid session', async () => {
      // Login first
      const loginResponse = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          password: FIXTURE_USER.password,
        }),
      });

      const cookies = loginResponse.headers.get('set-cookie') || '';
      const sessionMatch = cookies.match(/session=([^;]+)/);
      const sessionToken = sessionMatch![1];

      // Logout
      const logoutResponse = await authenticatedRequest(
        '/auth/logout',
        sessionToken,
        { method: 'POST' }
      );

      expect(logoutResponse.status).toBe(200);

      // Session should be invalidated
      const protectedResponse = await authenticatedRequest(
        '/api/me',
        sessionToken
      );

      expect(protectedResponse.status).toBe(401);
    });
  });

  describe('Multiple Users', () => {
    it('should maintain separate sessions for different users', async () => {
      // Login as first user
      const login1 = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: FIXTURE_USER.email,
          password: FIXTURE_USER.password,
        }),
      });

      const cookies1 = login1.headers.get('set-cookie') || '';
      const session1 = cookies1.match(/session=([^;]+)/)![1];

      // Login as second user
      const login2 = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email: EXISTING_USER.email,
          password: EXISTING_USER.password,
        }),
      });

      const cookies2 = login2.headers.get('set-cookie') || '';
      const session2 = cookies2.match(/session=([^;]+)/)![1];

      // Verify sessions are different
      expect(session1).not.toBe(session2);

      // Verify each session returns correct user
      const user1Response = await authenticatedRequest('/api/me', session1);
      const user1 = await user1Response.json();
      expect(user1.email).toBe(FIXTURE_USER.email);

      const user2Response = await authenticatedRequest('/api/me', session2);
      const user2 = await user2Response.json();
      expect(user2.email).toBe(EXISTING_USER.email);
    });
  });
});
