#!/usr/bin/env bash
#
# Local development stack for AgentForge, driven by the root Makefile.
#
#   scripts/dev-stack.sh up       start postgres + API + web server and wait until ready
#   scripts/dev-stack.sh down     stop the API and the web server (the database data is kept)
#   scripts/dev-stack.sh status   show what is running
#   scripts/dev-stack.sh logs     tail the API and web logs
#   scripts/dev-stack.sh test     run the CI checks (npm test, npm run build, go test ./...)
#
# Runtime state (PID files, logs, the throwaway Go module file) lives in $RUN_DIR
# (/tmp/agentforge-dev), never inside the repository working tree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
WEB_PORT="${WEB_PORT:-5173}"
DB_PORT="${DB_PORT:-5432}"
RUN_DIR="${RUN_DIR:-/tmp/agentforge-dev}"
STOP_DB="${STOP_DB:-0}"
DB_READY_TIMEOUT="${DB_READY_TIMEOUT:-60}"
API_READY_TIMEOUT="${API_READY_TIMEOUT:-60}"
WEB_READY_TIMEOUT="${WEB_READY_TIMEOUT:-60}"
GIT_REPOSITORY_ROOT="${GIT_REPOSITORY_ROOT:-$RUN_DIR/git}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-$RUN_DIR/evidence}"

# Database settings are read from the committed compose.yaml so this script never
# carries credentials of its own and stays in sync with the compose file.
compose_value() {
  sed -nE "s/^[[:space:]]*$1:[[:space:]]*([^[:space:]#]+).*/\1/p" "$REPO_ROOT/compose.yaml" | head -n 1 | tr -d "\"'"
}
DB_NAME="${DB_NAME:-$(compose_value POSTGRES_DB)}"
DB_USER="${DB_USER:-$(compose_value POSTGRES_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(compose_value POSTGRES_PASSWORD)}"

APP_ORIGIN="http://${HOST}:${WEB_PORT}"
API_BASE="http://127.0.0.1:${PORT}"
DATABASE_URL="${DATABASE_URL:-postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}?sslmode=disable}"

export POSTGRES_PORT="$DB_PORT"

step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

show_log_tail() {
  local file="$1" lines="${2:-40}"
  [ -f "$file" ] || return 0
  printf -- '----- last %s lines of %s -----\n' "$lines" "$file" >&2
  tail -n "$lines" "$file" >&2
}

pid_file() { printf '%s/%s.pid' "$RUN_DIR" "$1"; }

read_pid() {
  local file
  file="$(pid_file "$1")"
  [ -f "$file" ] || return 0
  cat "$file" 2>/dev/null || true
}

# A finished background job stays in the process table as a zombie until it is
# reaped, so "the PID exists" is not the same as "the process is alive".
process_alive() {
  local stat
  kill -0 "$1" 2>/dev/null || return 1
  stat="$(ps -p "$1" -o stat= 2>/dev/null | tr -d ' ')"
  [ -n "$stat" ] && [ "${stat:0:1}" != "Z" ]
}

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && return 0 || return 1
}

stop_process() {
  local name="$1" pid waited
  pid="$(read_pid "$name")"
  [ -n "$pid" ] || return 0
  if process_alive "$pid"; then
    # The process group is killed, not just the leader, so npm -> vite -> esbuild
    # goes away with it instead of leaving orphans behind.
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    waited=0
    while [ "$waited" -lt 50 ] && process_alive "$pid"; do
      sleep 0.2
      waited=$((waited + 1))
    done
    if process_alive "$pid"; then
      note "$name (pid $pid) ignored SIGTERM; sending SIGKILL"
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$(pid_file "$name")"
}

# The API and the web server are started with job control enabled, so each one
# becomes the leader of its own process group and can be stopped as a group.
# BG_PID holds the PID of the started process.
start_background() {
  local logfile="$1"
  shift
  set -m
  "$@" >"$logfile" 2>&1 &
  BG_PID=$!
  set +m
}

prepare_module_file() {
  # backend/api/go.mod is incomplete and backend/api/go.sum is not tracked, so a
  # plain `go build` fails in a fresh clone. CI works around it with `go mod tidy`;
  # here the tidy result is written to a throwaway module file outside the
  # repository, so the tracked go.mod/go.sum are left untouched.
  local moddir="$RUN_DIR/mod"
  mkdir -p "$moddir"
  cp "$REPO_ROOT/backend/api/go.mod" "$moddir/go.mod"
  (cd "$REPO_ROOT/backend/api" && go mod tidy -modfile="$moddir/go.mod") ||
    fail "go mod tidy failed for backend/api"
  echo "$moddir/go.mod"
}

check_port_free() {
  local name="$1" port="$2" pid owner
  pid="$(read_pid "$name")"
  if [ -n "$pid" ] && process_alive "$pid"; then
    return 0 # our own leftover process; it is stopped before starting
  fi
  if port_busy "$port"; then
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1 || true)"
    fail "port $port is already in use by another process and was not started by 'make dev'.
       Stop that process, or start the stack on other ports (for example
       'make dev PORT=9090 WEB_PORT=5199').
    $owner"
  fi
}

start_postgres() {
  step "Starting PostgreSQL (compose.yaml, service 'postgres')"
  if ! docker compose up -d postgres; then
    docker compose ps >&2 || true
    docker compose logs --tail 40 postgres >&2 || true
    fail "docker compose could not start the postgres service"
  fi
  local deadline=$((SECONDS + DB_READY_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if docker compose exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      note "postgres is accepting connections on 127.0.0.1:${DB_PORT} (database ${DB_NAME})"
      return 0
    fi
    sleep 1
  done
  docker compose ps >&2 || true
  docker compose logs --tail 40 postgres >&2 || true
  fail "PostgreSQL did not become ready within ${DB_READY_TIMEOUT}s"
}

build_api() {
  step "Building the API"
  local modfile
  modfile="$(prepare_module_file)"
  (cd "$REPO_ROOT/backend/api" && GOFLAGS="-modfile=$modfile" go build -o "$RUN_DIR/agentforge-api" ./cmd/server) ||
    fail "go build ./cmd/server failed"
  note "backend/api/go.mod and backend/api/go.sum were not modified"
}

start_api() {
  step "Starting the API on ${API_BASE}"
  start_background "$RUN_DIR/api.log" env \
    PORT="$PORT" \
    DATABASE_URL="$DATABASE_URL" \
    APP_ORIGIN="$APP_ORIGIN" \
    GIT_REPOSITORY_ROOT="$GIT_REPOSITORY_ROOT" \
    EVIDENCE_ROOT="$EVIDENCE_ROOT" \
    "$RUN_DIR/agentforge-api"
  echo "$BG_PID" >"$(pid_file api)"
  note "api pid $BG_PID, log $RUN_DIR/api.log"
}

wait_for_api() {
  step "Waiting for the API to answer /healthz"
  local pid deadline
  pid="$(read_pid api)"
  deadline=$((SECONDS + API_READY_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! process_alive "$pid"; then
      show_log_tail "$RUN_DIR/api.log" 40
      fail "the API process exited before /healthz answered"
    fi
    if curl -fsS -m 2 "$API_BASE/healthz" >/dev/null 2>&1; then
      note "$(curl -fsS -m 2 "$API_BASE/healthz")"
      return 0
    fi
    sleep 1
  done
  show_log_tail "$RUN_DIR/api.log" 40
  fail "the API did not answer /healthz within ${API_READY_TIMEOUT}s"
}

start_web() {
  step "Starting the Vite dev server on ${APP_ORIGIN}"
  start_background "$RUN_DIR/web.log" env \
    WEB_PORT="$WEB_PORT" \
    API_PROXY_TARGET="$API_BASE" \
    npm run dev --workspace @agentforge/web -- --strictPort
  echo "$BG_PID" >"$(pid_file web)"
  note "web pid $BG_PID, log $RUN_DIR/web.log"
}

wait_for_web() {
  step "Waiting for the web server to answer"
  local pid deadline
  pid="$(read_pid web)"
  deadline=$((SECONDS + WEB_READY_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! process_alive "$pid"; then
      show_log_tail "$RUN_DIR/web.log" 40
      fail "the web server exited before it answered"
    fi
    if curl -fsS -m 2 -o /dev/null "http://${HOST}:${WEB_PORT}/" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  show_log_tail "$RUN_DIR/web.log" 40
  fail "the web server did not answer within ${WEB_READY_TIMEOUT}s"
}

verify_proxy() {
  step "Verifying that the dev server proxies /api and /auth to the API"
  local status body
  body="$(curl -sS -m 5 -w $'\n%{http_code}' "http://${HOST}:${WEB_PORT}/api/v1/me" 2>/dev/null || true)"
  status="$(printf '%s' "$body" | tail -n 1)"
  body="$(printf '%s' "$body" | sed '$d')"
  if [ "$status" != "401" ]; then
    show_log_tail "$RUN_DIR/web.log" 20
    fail "the dev server did not forward /api/v1/me to the API (HTTP ${status:-none}, expected 401)"
  fi
  note "GET /api/v1/me -> HTTP 401 ${body}"
  status="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://${HOST}:${WEB_PORT}/auth/oidc/login" 2>/dev/null || true)"
  if [ "$status" = "404" ] || [ -z "$status" ]; then
    show_log_tail "$RUN_DIR/web.log" 20
    fail "the dev server did not forward /auth to the API (HTTP ${status:-none})"
  fi
  note "GET /auth/oidc/login -> HTTP ${status} (forwarded to the API)"
}

print_urls() {
  printf '\n'
  printf 'The AgentForge local stack is up:\n'
  printf '  Web app        http://%s:%s\n' "$HOST" "$WEB_PORT"
  printf '  API            %s\n' "$API_BASE"
  printf '  Health check   %s/healthz\n' "$API_BASE"
  printf '  API log        %s/api.log\n' "$RUN_DIR"
  printf '  Web log        %s/web.log\n' "$RUN_DIR"
  printf '\nPress Ctrl+C to stop everything, or run "make stop" from another shell.\n'
}

stack_running() {
  local api_pid web_pid
  api_pid="$(read_pid api)"
  web_pid="$(read_pid web)"
  [ -n "$api_pid" ] && [ -n "$web_pid" ] &&
    process_alive "$api_pid" && process_alive "$web_pid"
}

cleanup() {
  trap - EXIT INT TERM
  step "Stopping the local stack"
  stop_process web
  stop_process api
  note "the database and its data are left untouched"
}

on_signal() {
  cleanup
  exit 0
}

cmd_up() {
  mkdir -p "$RUN_DIR"
  if stack_running; then
    printf 'The local stack is already running.\n'
    print_urls
    printf 'Stop it with "make stop" first if you want a fresh start.\n'
    exit 0
  fi
  stop_process web
  stop_process api
  check_port_free api "$PORT"
  check_port_free web "$WEB_PORT"
  trap on_signal INT TERM
  trap cleanup EXIT
  start_postgres
  build_api
  start_api
  wait_for_api
  start_web
  wait_for_web
  verify_proxy
  print_urls
  step "The stack is running"
  while stack_running; do sleep 2; done
  if [ -z "$(read_pid api)" ] && [ -z "$(read_pid web)" ]; then
    note "the stack was stopped"
    exit 0
  fi
  fail "the API or the web server stopped unexpectedly"
}

cmd_down() {
  step "Stopping the local stack"
  stop_process web
  stop_process api
  if [ "$STOP_DB" = "1" ]; then
    docker compose stop postgres || true
    note "the postgres container was stopped; its volume and data are kept"
  else
    note "the postgres container keeps running; stop it with 'make stop STOP_DB=1'"
  fi
}

cmd_status() {
  local name pid
  for name in api web; do
    pid="$(read_pid "$name")"
    if [ -n "$pid" ] && process_alive "$pid"; then
      printf '%-6s running (pid %s)\n' "$name" "$pid"
    else
      printf '%-6s not running\n' "$name"
    fi
  done
  printf '\npostgres:\n'
  docker compose ps postgres 2>/dev/null || true
  printf '\nAPI health check (%s/healthz):\n' "$API_BASE"
  curl -sS -m 3 "$API_BASE/healthz" 2>&1 || true
  printf '\n'
}

cmd_logs() {
  [ -f "$RUN_DIR/api.log" ] || fail "no API log at $RUN_DIR/api.log (has 'make dev' been run?)"
  [ -f "$RUN_DIR/web.log" ] || fail "no web log at $RUN_DIR/web.log (has 'make dev' been run?)"
  tail -n 50 -f "$RUN_DIR/api.log" "$RUN_DIR/web.log"
}

cmd_test() {
  mkdir -p "$RUN_DIR"
  step "Ensuring PostgreSQL is up"
  start_postgres
  if [ ! -d "$REPO_ROOT/node_modules" ]; then
    step "Installing web dependencies (npm ci)"
    (cd "$REPO_ROOT" && npm ci --no-audit --no-fund) || fail "npm ci failed"
  fi
  step "npm test"
  (cd "$REPO_ROOT" && npm test) || fail "npm test failed"
  step "npm run build"
  (cd "$REPO_ROOT" && npm run build) || fail "npm run build failed"
  step "go test ./..."
  local modfile log skips
  modfile="$(prepare_module_file)"
  log="$RUN_DIR/go-test.log"
  (cd "$REPO_ROOT/backend/api" && DATABASE_URL="$DATABASE_URL" GOFLAGS="-modfile=$modfile" go test ./... -v) >"$log" 2>&1 || {
    show_log_tail "$log" 60
    fail "go test ./... failed (full log: $log)"
  }
  grep -E '^(ok|\?|FAIL)' "$log" || true
  skips="$(grep -c -- '--- SKIP' "$log" || true)"
  note "go test ./... passed, skipped tests: ${skips:-0} (full log: $log)"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  test) cmd_test ;;
  *)
    printf 'usage: %s {up|down|status|logs|test}\n' "$0" >&2
    exit 2
    ;;
esac
