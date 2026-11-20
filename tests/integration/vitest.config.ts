import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables
config({ path: resolve(__dirname, 'config/test.env') });

export default defineConfig({
  test: {
    name: 'integration',
    testTimeout: 30000,
    hookTimeout: 60000,
    teardownTimeout: 10000,
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    setupFiles: ['./setup-tests.ts'],
    // Run tests serially to avoid conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
