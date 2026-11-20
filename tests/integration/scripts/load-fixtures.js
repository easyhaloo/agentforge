#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesPath = join(__dirname, '../fixtures/test-users.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8081';

async function loadFixtures() {
  console.log('📦 Loading test fixtures...');

  for (const user of fixtures.users) {
    try {
      const response = await fetch(`${API_BASE}/auth/local/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          display_name: user.display_name,
        }),
      });

      if (response.ok) {
        console.log(`   ✓ Created user: ${user.email}`);
      } else if (response.status === 409) {
        console.log(`   ⚠ User already exists: ${user.email}`);
      } else {
        const error = await response.text();
        console.log(`   ✗ Failed to create ${user.email}: ${error}`);
      }
    } catch (error) {
      console.error(`   ✗ Error creating ${user.email}:`, error.message);
    }
  }

  console.log('✅ Fixture loading complete');
}

loadFixtures().catch((error) => {
  console.error('❌ Failed to load fixtures:', error);
  process.exit(1);
});
