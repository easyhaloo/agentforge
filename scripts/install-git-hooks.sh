#!/usr/bin/env bash
#
# Install Git hooks for AgentForge development
#
# This script copies hook scripts from scripts/git-hooks/ to .git/hooks/
# and makes them executable.
#
# Usage: ./scripts/install-git-hooks.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HOOKS_DIR="scripts/git-hooks"
GIT_HOOKS_DIR=".git/hooks"

if [ ! -d "$GIT_HOOKS_DIR" ]; then
    echo "Error: .git/hooks directory not found. Are you in a git repository?"
    exit 1
fi

echo "Installing Git hooks..."

# Install pre-push hook
if [ -f "$HOOKS_DIR/pre-push" ]; then
    cp "$HOOKS_DIR/pre-push" "$GIT_HOOKS_DIR/pre-push"
    chmod +x "$GIT_HOOKS_DIR/pre-push"
    echo "✅ Installed pre-push hook (Go formatting check)"
else
    echo "⚠️  pre-push hook not found in $HOOKS_DIR"
fi

echo ""
echo "Git hooks installed successfully!"
echo ""
echo "Hooks installed:"
echo "  - pre-push: Checks Go code formatting before push"
echo ""
echo "To bypass hooks (not recommended): git push --no-verify"
