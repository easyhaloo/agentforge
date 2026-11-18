# AgentForge local development stack.
#
#   make dev     start PostgreSQL, the Go API and the Vite dev server (default goal)
#   make stop    stop the API and the web server; the database data is kept
#   make status  show what is running
#   make logs    tail the API and web logs
#   make test    run the CI checks (npm test, npm run build, go test ./...)
#
# `make dev` keeps running in the foreground; Ctrl+C stops the API and the web
# server it started. Every setting can be overridden on the command line or in
# the environment, for example:
#
#   make dev PORT=9090 WEB_PORT=5199 DB_PORT=5433
#   make dev GIT_REPOSITORY_ROOT="$HOME/agentforge/git" EVIDENCE_ROOT="$HOME/agentforge/evidence"
#
# Runtime state (PID files, logs, the throwaway Go module file) lives in RUN_DIR
# outside the repository, so the working tree stays clean.

REPO_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

HOST                ?= 127.0.0.1
PORT                ?= 8080
WEB_PORT            ?= 5173
DB_PORT             ?= 5432
RUN_DIR             ?= /tmp/agentforge-dev
STOP_DB             ?= 0
GIT_REPOSITORY_ROOT ?= $(RUN_DIR)/git
EVIDENCE_ROOT       ?= $(RUN_DIR)/evidence
DB_READY_TIMEOUT    ?= 60
API_READY_TIMEOUT   ?= 60
WEB_READY_TIMEOUT   ?= 60

export HOST PORT WEB_PORT DB_PORT RUN_DIR STOP_DB
export GIT_REPOSITORY_ROOT EVIDENCE_ROOT
export DB_READY_TIMEOUT API_READY_TIMEOUT WEB_READY_TIMEOUT

.DEFAULT_GOAL := dev
.PHONY: dev stop status logs test

dev:
	@bash "$(REPO_ROOT)/scripts/dev-stack.sh" up

stop:
	@bash "$(REPO_ROOT)/scripts/dev-stack.sh" down

status:
	@bash "$(REPO_ROOT)/scripts/dev-stack.sh" status

logs:
	@bash "$(REPO_ROOT)/scripts/dev-stack.sh" logs

test:
	@bash "$(REPO_ROOT)/scripts/dev-stack.sh" test
