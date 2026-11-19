import { describe, it, expect } from 'vitest';
import { API_BASE_URL } from '../setup-tests';

describe('Complete Authentication Flow', () => {
  it('should handle full user journey: register -> login -> access -> logout', async () => {
    const uniqueEmail = `journey-${Date.now()}@example.com`;
    const user = {
      email: uniqueEmail,
      password: 'SecurePass123!',
      display_name: 'Journey Test User',
    };

    // Step 1: Register
    const registerResponse = await fetch(`${API_BASE_URL}/auth/local/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      credentials: 'include',
    });
    expect(registerResponse.status).toBe(201);

    let cookies = registerResponse.headers.get('set-cookie');
    let sessionCookie = cookies?.match(/session=[^;]+/)?.[0];

    // Step 2: Access protected resource (already logged in)
    let meResponse = await fetch(`${API_BASE_URL}/api/v1/me`, {
      headers: { Cookie: sessionCookie || '' },
    });
    expect(meResponse.status).toBe(200);

    // Step 3: Logout
    const logoutResponse = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: sessionCookie || '' },
    });
    expect(logoutResponse.status).toBe(204);

    // Step 4: Verify logged out (should get 401)
    meResponse = await fetch(`${API_BASE_URL}/api/v1/me`, {
      headers: { Cookie: sessionCookie || '' },
    });
    expect(meResponse.status).toBe(401);

    // Step 5: Login again
    const loginResponse = await fetch(`${API_BASE_URL}/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
      }),
      credentials: 'include',
    });
    expect(loginResponse.status).toBe(200);

    cookies = loginResponse.headers.get('set-cookie');
    sessionCookie = cookies?.match(/session=[^;]+/)?.[0];

    // Step 6: Access protected resource again
    meResponse = await fetch(`${API_BASE_URL}/api/v1/me`, {
      headers: { Cookie: sessionCookie || '' },
    });
    expect(meResponse.status).toBe(200);
  });

  it('should handle registration -> immediate protected access flow', async () => {
    const uniqueEmail = `instant-${Date.now()}@example.com`;
    const user = {
      email: uniqueEmail,
      password: 'TestPassword123',
      display_name: 'Instant Access User',
    };

    // Register
    const registerResponse = await fetch(`${API_BASE_URL}/auth/local/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
      credentials: 'include',
    });
    expect(registerResponse.status).toBe(201);

    const registerData = await registerResponse.json();
    const userId = registerData.user_id;

    // Extract session
    const cookies = registerResponse.headers.get('set-cookie');
    const sessionCookie = cookies?.match(/session=[^;]+/)?.[0];

    // Immediately access user data
    const meResponse = await fetch(`${API_BASE_URL}/api/v1/me`, {
      headers: { Cookie: sessionCookie || '' },
    });

    expect(meResponse.status).toBe(200);
    const meData = await meResponse.json();
    expect(meData.user_id).toBe(userId);
    expect(meData.email).toBe(user.email);
    expect(meData.display_name).toBe(user.display_name);
  });

  it('should prevent access to protected endpoints without authentication', async () => {
    // Try to access /api/v1/me without any session
    const response = await fetch(`${API_BASE_URL}/api/v1/me`);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toHaveProperty('title');
  });

  it('should prevent access with invalid session cookie', async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/me`, {
      headers: {
        Cookie: 'session=invalid-session-token-12345',
      },
    });

    expect(response.status).toBe(401);
  });
});
