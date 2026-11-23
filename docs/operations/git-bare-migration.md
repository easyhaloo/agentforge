# Migrate a first-party Git repository to bare storage

Run this procedure as the Git storage service account for locally initialized repositories. Keep the catalog entry and storage path. Schedule a maintenance window and stop API, worker and Git operations touching this repository before staging and until the switch is verified. Handle operator-managed repositories and remote bindings separately.

1. Check that the source is a standalone checkout with a real `.git` directory, exactly one worktree and a symbolic `HEAD` on the registered default branch. Stop if it is shallow, uses alternates, has outstanding Git locks or contains staged, modified, untracked or ignored files that have not been accounted for. Keep a backup that includes the working directory, configuration, hooks and reflogs. Only reviewed service-owned configuration should be applied to the bare repository.
2. Set `repo` to the existing absolute storage path. Stage and verify on the same filesystem while operations remain paused.

   ```bash
   set -eu
   umask 077
   if [ "$(git -C "$repo" rev-parse --is-bare-repository)" = true ]; then
     git -C "$repo" fsck --full --no-dangling
     exit 0
   fi
   test -d "$repo/.git" && test ! -L "$repo/.git" || exit 1
   test "$(git -C "$repo" rev-parse --is-shallow-repository)" = false || exit 1
   test ! -e "$repo/.git/objects/info/alternates" || exit 1
   test -z "$(git -C "$repo" status --porcelain=v1 --untracked-files=all --ignored)" || exit 1
   head_ref=$(git -C "$repo" symbolic-ref HEAD)
   stage=$(mktemp -d "$(dirname "$repo")/.git-bare-migration.XXXXXX")
   git clone --mirror --no-hardlinks --template= -- "$repo" "$stage/bare"
   git -C "$stage/bare" config --remove-section remote.origin
   if [ -f "$repo/.git/description" ]; then
     cp "$repo/.git/description" "$stage/bare/description"
   fi
   test "$(git -C "$stage/bare" rev-parse --is-bare-repository)" = true || exit 1
   test "$(git -C "$stage/bare" symbolic-ref HEAD)" = "$head_ref" || exit 1
   git -C "$repo" for-each-ref --format='%(refname) %(objectname) %(symref)' >"$stage/old-refs"
   git -C "$stage/bare" for-each-ref --format='%(refname) %(objectname) %(symref)' >"$stage/bare-refs"
   diff -u "$stage/old-refs" "$stage/bare-refs"
   git -C "$stage/bare" fsck --full --no-dangling
   ```

3. Rename the old directory to `"$stage/original"`, then rename `"$stage/bare"` to `"$repo"`. If the second rename fails, restore `"$stage/original"` before resuming operations. Retain the original outside the catalog path through the rollback window. Verify the same default SHA and refs at `"$repo"`, then check the Code page and read an existing Changeset Revision before allowing writes.
4. To roll back before allowing writes, pause operations, move the bare directory out of the catalog path and restore `"$stage/original"`. If writes have resumed, first snapshot the bare directory and reconcile refs and any new Git objects with the original. Keep operations paused until the restored checkout and its refs agree. A rollback must preserve newer user commits and delivery refs.
