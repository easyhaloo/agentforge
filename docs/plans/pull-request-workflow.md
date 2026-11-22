# Repository pull request delivery plan

1. Establish the [frontend standard](../development/pull-requests.md) from GitHub's list, compare and review flows. Keep stable Changeset links and reuse the real delivery pipeline.
2. Add compatible pull request metadata to the existing Changeset aggregate. Implement branch compare/create, draft/ready/close/reopen, and Revision-bound conversation against the API. Validate membership, CSRF, refs, immutable anchors and lifecycle on the server. Add focused Go tests and update the OpenAPI contract.
3. Add repository list, compare and detail routes with localized interaction and responsive layout. Use existing evaluation, review and Git merge operations.
4. Verify list isolation, draft transitions, branch diff, commit history, comments, changed-file review, stale Revision rejection, and merge in the real stack. Run frontend and backend suites and builds. Open a GitHub PR and verify its Actions checks.

## API contract

All paths below are under `/api/v1/organizations/{organizationID}`. Existing Changeset clients continue to work.

| Operation | Contract |
| --- | --- |
| List | `GET /changesets?repository=owner/name&state=open\|closed` returns the existing page shape. With `state` it filters native pull requests. Closed includes merged. |
| Create | Existing POST adds optional `base_branch`, `source_branch`, `expected_head_sha`, `description`, `draft`. `base_branch` opts into PR creation. Validate both published branches, nonempty three-dot diff, and expected head identity. Persist title, body and initial Revision in one write. |
| Stored PR | `changeset.pull_request` has `base_branch`, `source_branch`, `description`, `draft`, `closed`, `comments[]`. Each comment has `id`, `author`, `body`, `created_at` and optional `revision_id`, `path`, `side` (`left`/`right`), `line`. |
| Compare | Existing repository compare with `mode=merge-base&include_commits=true` returns `base_sha`, `head_sha`, `patch`, `commits[]` of `RepositoryCommit`, and `commits_truncated`. PR detail uses `GET /changesets/{id}/comparison` to get the same shape from its active Revision. Each PR Revision pins `base_sha` at creation or refresh, including after merge. |
| State | `POST /changesets/{id}/pull-request/state` with `{action: "ready" \| "draft" \| "close" \| "reopen"}` returns the updated stored Changeset. Author, owner or admin controls transitions. Merged is terminal. |
| Comment | `POST /changesets/{id}/pull-request/comments` with `{body, revision_id?, path?, side?, line?}` returns the updated stored Changeset. Inline anchors require all four optional properties and a current Revision. Stale anchors are rejected with 409. |
| Refresh Revision | `POST /changesets/{id}/revisions` continues to take `ref`. For a PR it must be its recorded source branch. Server resolves its current SHA and refuses duplicate SHA. Native PRs are refreshed from their source branch. WebIDE writes to legacy Changesets still add a Revision. |
| Verify, review and merge | Reuse existing routes. Draft/closed blocks approval and merge. Verify and merge against the stored base branch, with existing optimistic locking and stale-target protection. Legacy Changesets use the registered default branch. |

Repository routes use `.../repositories/:owner/:repo/pulls`, `/pulls/new` and `/pulls/:id` with `/commits`, `/checks`, `/files` subroutes. Existing organization Changeset routes remain valid. A repository detail route must verify that the loaded item belongs to the route's repository before showing its content.
