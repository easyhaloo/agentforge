#!/usr/bin/env bash
#
# Install git hooks from scripts/hooks/ to .git/hooks/
#
# Usage: ./scripts/install-git-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SOURCE="$REPO_ROOT/scripts/hooks"
HOOKS_TARGET="$REPO_ROOT/.git/hooks"

echo "🔧 Installing git hooks..."
echo ""

# Check if hooks source directory exists
if [ ! -d "$HOOKS_SOURCE" ]; then
    echo "❌ Error: hooks source directory not found: $HOOKS_SOURCE"
    exit 1
fi

# Create hooks target directory if it doesn't exist
mkdir -p "$HOOKS_TARGET"

# Install each hook
for hook in "$HOOKS_SOURCE"/*; do
    if [ -f "$hook" ]; then
        hook_name=$(basename "$hook")
        target_path="$HOOKS_TARGET/$hook_name"

        echo "  Installing $hook_name..."

        # Copy hook and make it executable
        cp "$hook" "$target_path"
        chmod +x "$target_path"

        echo "  ✅ $hook_name installed"
    fi
done

echo ""
echo "🎉 Git hooks installed successfully!"
echo ""
echo "Installed hooks:"
ls -1 "$HOOKS_TARGET" | grep -v ".sample" || echo "  (none)"
echo ""
echo "To bypass hooks: git push --no-verify"
echo ""
