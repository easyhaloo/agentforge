import { describe, it, expect, beforeEach } from 'vitest';
import { apiRequest, API_BASE_URL } from '../setup-tests';

describe('User Registration', () => {
  const uniqueEmail = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  describe('POST /auth/local/register', () => {
    it('should successfully register a new user with valid credentials', async () => {
      const email = uniqueEmail();
      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'SecurePass123!',
          display_name: 'New Test User',
        }),
      });

      expect(response.status).toBe(201);

      const result = await response.json();
      expect(result).toMatchObject({
        identity_id: expect.any(String),
        email,
        display_name: 'New Test User',
      });

      // Should return a session cookie
      const cookies = response.headers.get('set-cookie');
      expect(cookies).toContain('session=');
    });

    it('should reject registration with duplicate email', async () => {
      // Use a fixture user that already exists
      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'NewPassword123!',
          display_name: 'Duplicate User',
        }),
      });

      expect(response.status).toBe(409);

      const result = await response.json();
      expect(result).toMatchObject({
        error: expect.stringContaining('already exists'),
      });
    });

    it('should reject registration with weak password', async () => {
      const email = uniqueEmail();
      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'weak',
          display_name: 'Weak Password User',
        }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result).toMatchObject({
        error: expect.stringContaining('password'),
      });
    });

    it('should reject registration with invalid email format', async () => {
      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'SecurePass123!',
          display_name: 'Invalid Email User',
        }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result).toMatchObject({
        error: expect.stringContaining('email'),
      });
    });

    it('should reject registration with missing required fields', async () => {
      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email: uniqueEmail(),
          // Missing password and display_name
        }),
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result).toHaveProperty('error');
    });

    it('should trim and normalize email addresses', async () => {
      const baseEmail = uniqueEmail();
      const emailWithSpaces = `  ${baseEmail}  `;

      const response = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email: emailWithSpaces,
          password: 'SecurePass123!',
          display_name: 'Trimmed Email User',
        }),
      });

      expect(response.status).toBe(201);

      const result = await response.json();
      expect(result.email).toBe(baseEmail.trim().toLowerCase());
    });
  });

  describe('Registration + Login Flow', () => {
    it('should allow login immediately after registration', async () => {
      const email = uniqueEmail();
      const password = 'SecurePass123!';

      // Register
      const registerResponse = await apiRequest('/auth/local/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          display_name: 'Register Then Login User',
        }),
      });

      expect(registerResponse.status).toBe(201);

      // Login with the same credentials
      const loginResponse = await apiRequest('/auth/local/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
        }),
      });

      expect(loginResponse.status).toBe(200);

      const loginResult = await loginResponse.json();
      expect(loginResult.email).toBe(email.toLowerCase());
    });
  });
});
