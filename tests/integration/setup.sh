#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🚀 Starting integration test environment..."

# Load environment variables
if [ -f "$SCRIPT_DIR/config/test.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/config/test.env" | xargs)
fi

# 1. Start test database and API
echo "🐳 Starting Docker services..."
cd "$SCRIPT_DIR/config"
docker-compose -f docker-compose.test.yml up -d

# 2. Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if docker-compose -f docker-compose.test.yml ps | grep -q "healthy"; then
        HEALTHY_COUNT=$(docker-compose -f docker-compose.test.yml ps | grep -c "healthy" || echo "0")
        if [ "$HEALTHY_COUNT" -eq 2 ]; then
            echo "✅ All services are healthy"
            break
        fi
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo "   Still waiting... ($ELAPSED/${MAX_WAIT}s)"
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "❌ Services failed to become healthy within ${MAX_WAIT}s"
    docker-compose -f docker-compose.test.yml logs
    exit 1
fi

# 3. Run database migrations
echo "🗄️  Running database migrations..."
cd "$PROJECT_ROOT/backend/api"
export DATABASE_URL="postgres://test_user:test_password@localhost:5433/agentforge_test?sslmode=disable"

# Check if migration command exists
if [ -f "./cmd/migrate/main.go" ]; then
    go run ./cmd/migrate/main.go up
elif [ -f "./server" ]; then
    ./server migrate up
else
    echo "⚠️  No migration tool found, skipping migrations"
fi

# 4. Load test fixtures
echo "📦 Loading test fixtures..."
cd "$SCRIPT_DIR"
if [ -f "scripts/load-fixtures.js" ]; then
    node scripts/load-fixtures.js
else
    echo "⚠️  Fixture loader not found, skipping test data"
fi

# 5. Start frontend dev server in background
echo "🌐 Starting frontend dev server..."
cd "$PROJECT_ROOT/apps/web"

# Kill any existing process on port 5174
lsof -ti:5174 | xargs kill -9 2>/dev/null || true

# Start dev server
pnpm dev --port 5174 --host > /tmp/integration-web.log 2>&1 &
WEB_PID=$!
echo $WEB_PID > /tmp/integration-web.pid
echo "   Frontend PID: $WEB_PID"

# Wait for frontend to be ready
echo "⏳ Waiting for frontend to be ready..."
MAX_WAIT=30
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:5174 > /dev/null 2>&1; then
        echo "✅ Frontend is ready"
        break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "❌ Frontend failed to start within ${MAX_WAIT}s"
    cat /tmp/integration-web.log
    exit 1
fi

echo ""
echo "✅ Integration test environment is ready!"
echo ""
echo "   API: http://localhost:8081"
echo "   Web: http://localhost:5174"
echo "   DB:  localhost:5433/agentforge_test"
echo ""
echo "To run tests:"
echo "   cd $SCRIPT_DIR"
echo "   pnpm test"
echo ""
echo "To stop the environment:"
echo "   ./teardown.sh"
echo ""
