# PRD: Repository Detail Page

| Field | Value |
|---|---|
| Version | 1.0 |
| Status | Approved |
| Owner | Product Team |
| Last updated | 2024-11-19 |

## Current Implementation Status Note

The canonical route is `/orgs/:org/repositories/:owner/:repo`. It opens the code browser, with separate URLs for Issues, Pull requests, Actions, Projects, and Settings. The legacy single-segment route `/orgs/:org/repositories/:repositorySlug` still opens `RepositoryDetailPage` and uses the shared Light and Dark theme tokens. The PRD below records the original tab-based design. See [ADR-008](../architecture/decisions.md#adr-008-scoped-url-routing).

## 1. Background & Problem

AgentForge users need a comprehensive interface to browse repository contents, manage workflows, track issues and pull requests, configure settings, and collaborate with team members. Currently, users lack a unified repository detail page that provides GitHub-equivalent functionality while integrating AgentForge-specific features such as Changesets, artifact management, and agent-based workflows.

Target users include developers browsing code, project managers tracking progress, and code reviewers examining changes. Without a complete repository detail interface, users must rely on fragmented views or external tools, reducing productivity and platform adoption.

## 2. Goals & Success Measures

| Goal ID | Expected outcome | Success measure |
|---|---|---|
| GOAL-001 | Users can efficiently browse and navigate repository contents | Users complete code browsing tasks without errors |
| GOAL-002 | Users can manage workflows, issues, and pull requests within the platform | All business flows complete successfully without 4xx/5xx errors |
| GOAL-003 | Repository owners can configure settings and manage team access | Settings changes persist correctly and permissions apply as expected |
| GOAL-004 | The interface provides GitHub-equivalent UX with AgentForge enhancements | Page layout matches GitHub design patterns; AgentForge features are accessible |

## 3. Users & User Stories

| User ID | User / role | User story | Value |
|---|---|---|---|
| USER-001 | Developer | As a developer, I want to browse repository files in a tree structure | So that I can quickly locate and read source code |
| USER-002 | Developer | As a developer, I want to view file contents with syntax highlighting | So that I can understand code structure and logic |
| USER-003 | Project Manager | As a project manager, I want to view and filter issues | So that I can track project progress and prioritize work |
| USER-004 | Code Reviewer | As a code reviewer, I want to view pull requests with diffs | So that I can review changes before approval |
| USER-005 | DevOps Engineer | As a DevOps engineer, I want to view workflow runs and their status | So that I can monitor CI/CD pipeline health |
| USER-006 | Developer | As a developer, I want to view and download published packages | So that I can integrate dependencies into my projects |
| USER-007 | Technical Writer | As a technical writer, I want to browse and edit wiki pages | So that I can maintain project documentation |
| USER-008 | Repository Owner | As a repository owner, I want to configure repository settings | So that I can control access, branches, and integrations |
| USER-009 | Admin | As an admin, I want to manage organization members and permissions | So that I can control who can access and modify the repository |

## 4. Scope

| In scope | Out of scope |
|---|---|
| 8 primary tabs: Code, Issues, Pull Requests, Actions, Packages, Wiki, Settings, Members | Creating or editing code files (handled by WebIDE) |
| GitHub-equivalent UI design and interaction patterns | Real-time collaboration features (e.g., live cursors) |
| File tree navigation with expand/collapse | Git operations (clone, push, pull) from the UI |
| Syntax-highlighted code viewing | Advanced search across repositories |
| Issue list with filtering and quick actions | Issue creation and editing (view-only) |
| Pull request list with This Repository / Related tabs | Pull request creation and merge (view-only) |
| Workflow runs display with status indicators | Workflow editing (view-only) |
| Package list with version and download information | Package publishing (view-only) |
| Wiki page navigation and content display | Wiki page editing (separate feature) |
| Repository settings with forms and controls | Deleting repositories |
| Member list with role filtering | Inviting new members |
| Role-based visibility (Settings: Owner only; Members: Admin only) | User profile management |
| Integration with AgentForge Changeset mechanism | Migration from legacy Git hosting |
| Artifact repository configuration in Settings | Build system configuration |

## 5. Functional Requirements & Acceptance Criteria

| Requirement ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-001 | Display repository header with name, visibility badge, description, and metadata | Must | AC-001: Given a user views a repository, when the page loads, then the header displays repository name, Public/Private badge, description, star count, fork count, and watchers count |
| FR-002 | Provide horizontal tab navigation for 8 sections | Must | AC-002: Given a user views the repository page, when the page loads, then 8 tabs are visible: Code, Issues, Pull Requests, Actions, Packages, Wiki, Settings, Members. AC-003: Given a user clicks a tab, when the click completes, then that tab becomes active (orange underline) and its content displays. AC-004: Given a user views the page, when no tab is explicitly selected, then Code tab is active by default |
| FR-003 | Display action buttons for common operations | Must | AC-005: Given a user views the repository header, when the page loads, then Watch, Fork, and Star buttons are visible and clickable |
| FR-004 | Display file tree with hierarchical folder structure | Must | AC-006: Given a user views the Code tab, when the page loads, then a file tree displays on the left with folders and files. AC-007: Given a user clicks a folder, when the click completes, then the folder expands or collapses with a chevron animation. AC-008: Given a user clicks a file, when the click completes, then the file content displays on the right |
| FR-005 | Display file contents with syntax highlighting | Must | AC-009: Given a user selects a code file, when the file loads, then content displays with appropriate syntax highlighting based on file extension. AC-010: Given a user selects a non-code file (image, binary), when the file loads, then an appropriate viewer or download option displays |
| FR-006 | Show file metadata in header | Must | AC-011: Given a file is selected, when content displays, then the header shows filename and file path |
| FR-007 | Display issue list with status, title, author, and timestamp | Must | AC-012: Given a user views the Issues tab, when the page loads, then a list of issues displays with status icon (open/closed), title, author, labels, and timestamp |
| FR-008 | Provide left sidebar with filter options for Issues | Must | AC-013: Given a user views the Issues tab, when the page loads, then a left sidebar displays with filter sections: Open issues, Closed issues, Assigned to me, Created by me. AC-014: Given a user clicks a filter option, when the click completes, then the filter becomes active (blue left border + light blue background) and the issue list updates |
| FR-009 | Support search with expression filtering for Issues | Must | AC-015: Given a user types in the search box, when they enter "is:issue state:open", then only open issues display. AC-016: Given a user types a keyword, when they press Enter, then issues matching the keyword display |
| FR-010 | Provide quick filter dropdowns for Issues | Must | AC-017: Given a user clicks a dropdown button (Author, Label, Projects, Milestones, Assignee, Sort), when the dropdown opens, then available options display. AC-018: Given a user selects a dropdown option, when the selection completes, then the issue list filters accordingly |
| FR-011 | Display pull request list with status, title, author, and branch information | Must | AC-019: Given a user views the Pull Requests tab, when the page loads, then a list of pull requests displays with status icon (open/merged/closed), title, author, source/target branches, and timestamp |
| FR-012 | Provide sub-tabs for This Repository and Related pull requests | Must | AC-020: Given a user views the Pull Requests tab, when the page loads, then two sub-tabs display: This Repository (active by default) and Related. AC-021: Given a user clicks Related, when the click completes, then the Related sub-tab becomes active and related pull requests display |
| FR-013 | Provide left sidebar with filter options for Pull Requests | Must | AC-022: Given a user views the Pull Requests tab, when the page loads, then a left sidebar displays with filter sections: Open pull requests, Closed pull requests, Created by me, Assigned to me. AC-023: Given a user clicks a filter option, when the selection completes, then the filter becomes active and the PR list updates |
| FR-014 | Support search with expression filtering for Pull Requests | Must | AC-024: Given a user types in the search box, when they enter "is:pr state:open", then only open pull requests display |
| FR-015 | Provide quick filter dropdowns for Pull Requests | Must | AC-025: Given a user clicks a dropdown button (Author, Label, Reviews, Assignee, Sort), when the dropdown opens, then available options display and can be selected |
| FR-016 | Display workflow list in left sidebar | Must | AC-026: Given a user views the Actions tab, when the page loads, then a left sidebar displays with sections: All workflows, Recent runs, Usage, and a Workflows section listing available workflows. AC-027: Given a user clicks a workflow name, when the click completes, then the workflow becomes active (blue left border + light blue background) and workflow runs display on the right |
| FR-017 | Display workflow run history with status | Must | AC-028: Given a user views a workflow's runs, when the content loads, then each run displays with status icon (success/failure/in-progress), run number, branch, timestamp, and duration. AC-029: Given a workflow has no runs, when the content loads, then an empty state message displays |
| FR-018 | Provide New workflow button | Must | AC-030: Given a user views the Actions tab sidebar, when the page loads, then a New workflow button displays at the bottom of the sidebar |
| FR-019 | Display package list in left sidebar | Must | AC-031: Given a user views the Packages tab, when the page loads, then a left sidebar displays with available packages (e.g., agentforge-web, agentforge-cli, agentforge-api). AC-032: Given a user clicks a package name, when the click completes, then the package becomes active and package details display on the right |
| FR-020 | Display package details with version and metadata | Must | AC-033: Given a user selects a package, when the details load, then the content displays package name, version, description, publish date, download count, and installation instructions |
| FR-021 | Display wiki page list in left sidebar | Must | AC-034: Given a user views the Wiki tab, when the page loads, then a left sidebar displays with wiki pages: Home, Getting Started, Architecture, API Reference, Contributing, FAQ. AC-035: Given a user clicks a wiki page name, when the click completes, then the page becomes active (blue left border + light blue background) and page content displays on the right |
| FR-022 | Display wiki page content with formatting | Must | AC-036: Given a user selects a wiki page, when the content loads, then the page displays formatted Markdown content with headings, lists, links, and code blocks |
| FR-023 | Display settings navigation in left sidebar with workspace mode | Must | AC-037: Given a repository owner views the Settings tab, when the page loads, then a left sidebar displays with settings sections: General, Access, Branches, Tags, Notifications, Webhooks, Moderation, Rulesets, Actions, Environments, Secrets, Copilot, Pages, Security. AC-038: Given a user clicks a settings section, when the click completes, then the section becomes active and the corresponding settings page displays on the right |
| FR-024 | Restrict Settings tab visibility to repository owners | Must | AC-039: Given a non-owner user views the repository, when the page loads, then the Settings tab is not visible. AC-040: Given a repository owner views the repository, when the page loads, then the Settings tab is visible and clickable |
| FR-025 | Display General settings page with repository configuration | Must | AC-041: Given an owner views General settings, when the page loads, then the page displays: Repository name input, Description textarea, Visibility selector (Public/Private), Default branch selector, Archive repository option, and Delete repository option (greyed out or restricted) |
| FR-026 | Display Branches settings page with protection rules | Must | AC-042: Given an owner views Branches settings, when the page loads, then the page displays: Default branch setting, Branch protection rules list, Add rule button |
| FR-027 | Display Actions settings page with permissions | Must | AC-043: Given an owner views Actions settings, when the page loads, then the page displays: Actions permissions radio buttons, Workflow permissions checkboxes, Retention period selector |
| FR-028 | Display Environments settings page | Must | AC-044: Given an owner views Environments settings, when the page loads, then the page displays: Environment list (e.g., production, staging), Protection rules, Environment variables section |
| FR-029 | Display Secrets settings page | Must | AC-045: Given an owner views Secrets settings, when the page loads, then the page displays: Actions secrets list, New repository secret button, Secret name and value inputs (masked) |
| FR-030 | Display artifact repository configuration in Settings | Must | AC-046: Given an owner views Settings, when navigating to artifact/package configuration, then the page displays: Artifact repository URL, Authentication method, Storage quota, Retention policy |
| FR-031 | Display member list with roles | Must | AC-047: Given an admin views the Members tab, when the page loads, then a member list displays with avatars, usernames, roles (Owner, Member, External Collaborator), and last active timestamps |
| FR-032 | Provide left sidebar with member filters | Must | AC-048: Given an admin views the Members tab, when the page loads, then a left sidebar displays with filters: Organization Members, External Collaborators, Pending invitations. AC-049: Given a user clicks a filter, when the selection completes, then the filter becomes active and the member list updates |
| FR-033 | Restrict Members tab visibility to admins | Must | AC-050: Given a non-admin user views the repository, when the page loads, then the Members tab is not visible. AC-051: Given an admin user views the repository, when the page loads, then the Members tab is visible and clickable |
| FR-034 | Support Changeset-based workflow in Code tab | Must | AC-052: Given a developer views a file in Code tab, when WebIDE integration is available, then an Open in WebIDE button displays. AC-053: Given a user clicks Open in WebIDE, when the action completes, then the file opens in WebIDE for Changeset-based editing |
| FR-035 | Integrate Changeset references in Pull Requests | Must | AC-054: Given a pull request is linked to a Changeset, when the PR displays, then Changeset ID and link display in the PR metadata |

## 6. Business Rules

| Rule ID | Rule | Applies when | Observable consequence |
|---|---|---|---|
| BR-001 | Only repository owners can view Settings tab | User accesses repository detail page | Settings tab is hidden for non-owners; visible for owners |
| BR-002 | Only admins can view Members tab | User accesses repository detail page | Members tab is hidden for non-admins; visible for admins |
| BR-003 | Code tab is default active tab on page load | User navigates to repository detail page without tab parameter | Code tab displays with active state; file tree and content are visible |
| BR-004 | Sidebar filters use workspace mode for Settings, Actions, Packages, Wiki | User views tabs with multiple independent pages | Clicking a sidebar item switches to a different page; each page has independent content |
| BR-005 | Sidebar filters use filter mode for Issues, Members | User views tabs where filters affect the same content | Clicking a sidebar item filters the displayed list; content updates dynamically |

## 7. Product Constraints & Quality Requirements

| ID | Constraint / quality | Required outcome | Rationale |
|---|---|---|---|
| NFR-001 | Page layout must match GitHub design patterns | Visual design achieves 95%+ similarity to GitHub's repository page in user testing | Reduce learning curve for users familiar with GitHub |
| NFR-002 | All API calls must return HTTP 200 for valid requests | No 404, 401, 403, or 5xx errors occur during normal usage flows | Ensure reliable backend integration and proper error handling |
| NFR-003 | Tab switching must be responsive | Tab content displays within 500ms of clicking a tab button | Provide smooth user experience without perceived lag |
| NFR-004 | File tree must handle repositories with 1000+ files | File tree renders and remains interactive with large repositories | Support real-world repository sizes |
| NFR-005 | Syntax highlighting must support major languages | At minimum: JavaScript, TypeScript, Python, Go, Java, C++, Rust, HTML, CSS, Markdown | Cover most common development use cases |
| NFR-006 | All user-visible text must support i18n | Text displays in user's selected language (English and Chinese at minimum) | Support international user base |
| NFR-007 | Page must be accessible via keyboard navigation | All interactive elements are reachable and operable via keyboard | Meet accessibility standards |
| NFR-008 | Design must use GitHub light theme color palette | All colors match GitHub's light theme variables (e.g., --gh-color-primary: #0969da) | Maintain visual consistency with GitHub |

## 8. Related Flow or State Model

### Tab Navigation Flow

When a user lands on the repository page, the Code tab is active by default. When the user clicks a tab button, the system checks permissions. For valid access, the system removes the active class from the current tab, adds the active class to the clicked tab, hides the current tab content, shows the target tab content, and updates the URL with the tab parameter. For Settings tab, only owners have access. For Members tab, only admins have access. If unauthorized, the tab is hidden.

**Related FRs**: FR-002, FR-024, FR-033

### Sidebar Interaction Modes

**Filter Mode** (Issues, Members):
- Clicking sidebar item filters displayed content
- Content updates in place
- Multiple items can affect the same list

**Workspace Mode** (Actions, Packages, Wiki, Settings):
- Clicking sidebar item switches to different page
- Each item has independent content
- Only one page visible at a time

**Related FRs**: FR-008, FR-013, FR-017, FR-019, FR-021, FR-023, FR-032

## 9. Confirmed Product Decisions

| Decision | Confirmed choice | Rationale |
|---|---|---|
| UI design alignment | Exactly replicate GitHub's design and interaction patterns | Minimize user learning curve; leverage established UX patterns |
| Feature completeness | All 8 tabs must be implemented in first release | Provide complete repository management interface from day one |
| Implementation approach | Can be split into multiple tasks but must deliver all features | Allow parallel development while ensuring complete delivery |
| AgentForge integration | Enhance GitHub-equivalent features with Changeset and artifact repository support | Differentiate AgentForge while maintaining familiar workflows |
| Permission model | Settings tab: Owner only; Members tab: Admin only | Follow GitHub's permission conventions |
| Color theme | GitHub light theme only | Simplify initial implementation; maintain consistency |
| Default tab | Code tab active on page load | Match user expectation for repository browsing |

## 10. Traceability

| Goal / User Story | Requirement | Acceptance Criterion |
|---|---|---|
| GOAL-001 / USER-001 | FR-004 | AC-006, AC-007, AC-008 |
| GOAL-001 / USER-002 | FR-005 | AC-009, AC-010 |
| GOAL-002 / USER-003 | FR-007, FR-008, FR-009, FR-010 | AC-012, AC-013, AC-014, AC-015, AC-016, AC-017, AC-018 |
| GOAL-002 / USER-004 | FR-011, FR-012, FR-013, FR-014, FR-015 | AC-019, AC-020, AC-021, AC-022, AC-023, AC-024, AC-025 |
| GOAL-002 / USER-005 | FR-016, FR-017, FR-018 | AC-026, AC-027, AC-028, AC-029, AC-030 |
| GOAL-002 / USER-006 | FR-019, FR-020 | AC-031, AC-032, AC-033 |
| GOAL-002 / USER-007 | FR-021, FR-022 | AC-034, AC-035, AC-036 |
| GOAL-003 / USER-008 | FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030 | AC-037-AC-046 |
| GOAL-003 / USER-009 | FR-031, FR-032, FR-033 | AC-047-AC-051 |
| GOAL-004 / USER-001, USER-002 | FR-001, FR-002, FR-003, FR-034, FR-035, NFR-001, NFR-008 | AC-001, AC-002, AC-003, AC-004, AC-005, AC-052, AC-053, AC-054 |
