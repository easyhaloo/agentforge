import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables
config({ path: resolve(__dirname, 'config/test.env') });

// Export test configuration
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8081';
export const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:5174';
export const TEST_TIMEOUT = Number(process.env.TEST_TIMEOUT) || 30000;

// Global test setup
beforeAll(async () => {
  console.log('🧪 Running integration test setup...');
  console.log(`   API: ${API_BASE_URL}`);
  console.log(`   Web: ${WEB_BASE_URL}`);

  // Verify API is healthy
  try {
    const response = await fetch(`${API_BASE_URL}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`API health check failed: ${response.status}`);
    }

    console.log('   ✅ API is healthy');
  } catch (error) {
    console.error('   ❌ API health check failed:', error);
    throw new Error(
      'Integration test environment is not ready. Run ./setup.sh first.'
    );
  }

  // Verify Web is accessible
  try {
    const response = await fetch(WEB_BASE_URL, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Web health check failed: ${response.status}`);
    }

    console.log('   ✅ Web is accessible');
  } catch (error) {
    console.error('   ❌ Web health check failed:', error);
    throw new Error(
      'Frontend dev server is not ready. Run ./setup.sh first.'
    );
  }

  console.log('✅ Integration test environment verified');
}, TEST_TIMEOUT);

// Global test teardown
afterAll(() => {
  console.log('🧹 Integration test cleanup complete');
});

// Helper function for API requests
export async function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// Helper function for authenticated API requests
export async function authenticatedRequest(
  path: string,
  sessionToken: string,
  options: RequestInit = {}
): Promise<Response> {
  return apiRequest(path, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: `session=${sessionToken}`,
    },
  });
}
