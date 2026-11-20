#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🛑 Stopping integration test environment..."

# 1. Stop frontend dev server
if [ -f /tmp/integration-web.pid ]; then
    WEB_PID=$(cat /tmp/integration-web.pid)
    echo "   Stopping frontend (PID: $WEB_PID)..."
    kill $WEB_PID 2>/dev/null || true
    rm /tmp/integration-web.pid
fi

# Also kill any process on port 5174
lsof -ti:5174 | xargs kill -9 2>/dev/null || true

# 2. Stop Docker services
echo "   Stopping Docker services..."
cd "$SCRIPT_DIR/config"
docker-compose -f docker-compose.test.yml down -v

# 3. Clean up log files
rm -f /tmp/integration-web.log

echo "✅ Integration test environment stopped"
