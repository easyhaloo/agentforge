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
                          Comment composer
Files changed             Filter and file tree         Unified or Split patches and line discussions
```

- Reuse the repository masthead, shared form controls, status treatments, compact rows, buttons and repository diff rendering. Use AgentForge theme tokens, typography, icons and focus treatments in both themes. State always has a text label. Use monospace for branch refs, SHAs and patch lines. Keep a readable measure for descriptions and discussion.
- Use real routes and links with current-page semantics. Store list filters in the URL and reset paging on filter changes. Compare accepts two published branches, defaults the base to the registered default branch and previews the three-dot comparison before submission. Disable creation for invalid or empty comparisons and when the displayed selection has changed. Keep values on rejection.
- Conversation shows persisted description, comments and lifecycle activity, with the latest Revision and gate facts alongside. Give older inline annotations context with their original Revision. The Checks view distinguishes missing, failed, evidence required, and passed checks, and reports the evaluated Revision. Checks and review state come from server responses. Files changed uses the active Revision SHA and provides line-level commenting with explicit old/new side.
- Stack secondary panels on narrow screens and use independently scrolling patch regions and wrapping branch chips. Tab controls and file anchors stay keyboard reachable. Use visible labels, `aria-current`, status messages and error alerts. Move focus into any opened composer and restore it upon cancellation. Preserve input when saving fails. Each surface has loading, empty, permission and retryable error states. All product strings use `en-US` and `zh-CN` resources.
- A pull request is a repository view over a Changeset. Use its stable ID in links and bind checks, decisions and inline comments to a Revision. Only the author and repository managers control draft, close and reopen. An assigned reviewer decides with passing evidence for the active Revision. Merge targets the recorded base branch and the service verifies current approval, passing evidence, the evaluated target SHA and Git conflict outcomes. Comments and diff text render as untrusted data.

AgentForge uses the verified Changeset merge policy and a real merge commit. GitHub's wider ecosystem also includes fork comparisons, code-owner policy, multiple review groups, suggestions, merge queues, squash/rebase methods and projects or milestones. The native workflow ships with the repository and delivery capabilities specified here.

## Files changed

- Group changed paths into expandable directories. Each file shows a localized icon for added, deleted, modified, or renamed status and its own `+` additions and `−` deletions. Filter by path. Selecting a file opens its patch if collapsed, scrolls to it, and focuses its header.
- **Hide files** and **Show files** collapse and restore the sidebar. On wide screens, drag the separator or use Left/Right to resize it by 10 px and Home/End to reach the 200–480 px bounds. The sidebar starts at 280 px and remembers its width and visibility. At 760 px and below, the tree stacks above the patches and the resize handle is hidden.
- **Unified** is the default. **Split** shows old lines on the left and new lines on the right, with side-specific line comments still bound to the active Revision. At 760 px and below, use Unified and disable the Split control. Widening the viewport restores Split if it was selected.

## Detail typography and navigation

- Use a 24–32px title and a 14px branch summary. Use monospace chips for the source and target refs. The lifecycle badge pairs a 16px state icon with a text label and the AgentForge success, danger, merged or neutral token.
- Show a pencil beside the title for the author with write access and for organization owners and admins. Open a focused title field in the header with Cancel and Save. Enter saves and Escape cancels. Retain the draft if saving fails. Titles are Changeset metadata. Editing a title preserves the active Revision, evidence, and review decisions.
- The tab strip uses 14px labels, 18px Lucide icons, 12px counts, and a 44px minimum hit area. Use pill-shaped counts. Outline the selected tab on the top and sides with rounded top corners. Its open bottom interrupts the shared baseline, and the selected icon uses the AgentForge accent. A visible focus ring identifies keyboard focus. Narrow screens scroll the strip horizontally. Each selection has a URL and labels its content panel. Arrow keys, Home and End use the shared tab behavior.
- Count persisted conversation comments, including inline comments. Count commits and changed files from the same pinned comparison rendered by their views. A `+` suffix marks truncated commit history. Hide unavailable counts and show a retryable error in comparison views. Count the result of the latest evaluation for the active Revision in Checks.
- Start Conversation with the proposal body. Avatars and event markers connect discussion and delivery events in chronological order. The Changeset sidebar links to the stable ID and identifies the active Revision number, commit and evidence status. Display reviewer status for that Revision. The merge section exposes the action when the server reports that the Revision is ready. Keep append-only history visible when the source branch adds a Revision.
- Use a static PR status badge. Select the creation mode from the arrow beside the create button. In Conversation, place Ready for review in the draft section of the merge box above the disabled merge button. Place Convert to draft under Reviewers in the sidebar and confirm the transition. Show request errors by the initiating control.
- Show an out-of-date row in the merge box when the server suggests updating the source branch. The split button defaults to the first supported method. The arrow selects an update method and the main button runs it directly. Require any repository sign-off in the row and show progress and errors there.
- Place Close pull request and Reopen pull request in the Conversation composer footer, immediately before Comment and aligned to the trailing edge. Use a neutral button with a red closed-pull-request icon for Close. Preserve the comment draft during lifecycle updates.
