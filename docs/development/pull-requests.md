# Pull request frontend standard

## GitHub reference

The repository pull request list puts search and creation above status filters and compact rows. Each row leads with state and title, then presents the identifier, author, time and discussion count. The detail header groups title, state and the head-to-base branch relationship above Conversation, Commits, Checks and Files changed. Conversation gives the timeline most of the width and keeps reviewer metadata beside it. Commits lists immutable commits. Checks groups results by the evaluated commit. Files changed pairs a filterable file tree with collapsible patches, line numbers, contextual actions and review submission. Compare precedes creation and selects a base and a head. Draft, ready, closed, reopened and merged states affect the actions available. Review discussions may outlive the code they originally annotated.

Observed on November 22, 2026 in the [repository list](https://github.com/easyhaloo/agentforge/pulls) and [live pull request](https://github.com/easyhaloo/agentforge/pull/142). GitHub documents [creation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request), [review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) and [merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request).

## AgentForge pattern

```text
Repository masthead       Code · Issues · Pull requests · Branches · Actions

List                      Search                         New pull request
                          Open · Closed                 Review filter
                          Title and state
                          Author · time · head → base

Create                    Base branch       ←        Compare branch
                          Commit and file preview
                          Title · description · draft     Create

Detail                    Title                         Status
                          head → base · author · time
                          Conversation · Commits · Checks · Files changed
                          Timeline and merge gate       Reviewer / branch facts
Files changed             Filter and file index        Patch and line discussions
```

- Reuse the repository masthead, shared form controls, status treatments, compact rows, buttons and repository diff rendering. Use AgentForge theme tokens, typography, icons and focus treatments in both themes. State always has a text label. Use monospace for branch refs, SHAs and patch lines. Keep a readable measure for descriptions and discussion.
- Use real routes and links with current-page semantics. Store list filters in the URL and reset paging on filter changes. Compare accepts two published branches, defaults the base to the registered default branch and previews the three-dot comparison before submission. Disable creation for invalid or empty comparisons and when the displayed selection has changed. Keep values on rejection.
- Conversation shows persisted description, comments and lifecycle activity, with the latest Revision and gate facts alongside. Give older inline annotations context with their original Revision. The Checks view distinguishes missing, failed, evidence required, and passed checks, and reports the evaluated Revision. Checks and review state come from server responses. Files changed uses the active Revision SHA and provides line-level commenting with explicit old/new side.
- Stack secondary panels on narrow screens and use independently scrolling patch regions and wrapping branch chips. Tab controls and file anchors stay keyboard reachable. Use visible labels, `aria-current`, status messages and error alerts. Move focus into any opened composer and restore it upon cancellation. Preserve input when saving fails. Each surface has loading, empty, permission and retryable error states. All product strings use `en-US` and `zh-CN` resources.
- A pull request is a repository view over a Changeset. Use its stable ID in links and bind checks, decisions and inline comments to a Revision. Only the author and repository managers control draft, close and reopen. An assigned reviewer decides with passing evidence for the active Revision. Merge targets the recorded base branch and the service verifies current approval, passing evidence, the evaluated target SHA and Git conflict outcomes. Comments and diff text render as untrusted data.

AgentForge uses the verified Changeset merge policy and a real merge commit. GitHub's wider ecosystem also includes fork comparisons, code-owner policy, multiple review groups, suggestions, merge queues, squash/rebase methods and projects or milestones. The native workflow ships with the repository and delivery capabilities specified here.
