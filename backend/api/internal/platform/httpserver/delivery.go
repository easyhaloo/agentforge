package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/events"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/labels"
	"github.com/easyhaloo/agentforge/backend/api/internal/milestones"
	"github.com/easyhaloo/agentforge/backend/api/internal/notifications"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/reactions"
	"github.com/easyhaloo/agentforge/backend/api/internal/tasks"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

type Principal = identity.Principal

type PrincipalResolver = identity.PrincipalResolver

type AccountRepository interface {
	CurrentAccount(context.Context, string) (identity.AccountContext, error)
}

type MembershipRepository interface {
	ListMembers(context.Context, string, int, int) ([]identity.OrganizationMember, error)
	UpdateMembership(context.Context, string, string, string, *string, *string) (identity.OrganizationMember, error)
	RemoveMembership(context.Context, string, string, string) error
	CreateInvitation(context.Context, string, string, string, string, string, time.Time) (identity.OrganizationInvitation, error)
	ListInvitations(context.Context, string, int, int) ([]identity.OrganizationInvitation, error)
	RevokeInvitation(context.Context, string, string, string) error
	ListMembershipAudit(context.Context, string, int, int) ([]identity.MembershipAuditEvent, error)
}

type ReviewerAuthorizer interface {
	IsActiveMember(context.Context, string, string) (bool, error)
}

type LocalAuthHandler interface {
	Login(http.ResponseWriter, *http.Request)
	Register(http.ResponseWriter, *http.Request)
}

type IssueRepository interface {
	Create(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error)
	Get(ctx context.Context, organizationID, repository string, number int) (*issues.Issue, error)
	List(ctx context.Context, organizationID string, filter issues.ListFilter, limit, offset int) ([]*issues.Issue, int, error)
	Update(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error)
	Close(ctx context.Context, organizationID string, issueID issues.ID, reason issues.StateReason, closedBy string, closedAt time.Time) (*issues.Issue, error)
	AddAssignee(ctx context.Context, organizationID string, issueID string, userID string) error
	RemoveAssignee(ctx context.Context, organizationID string, issueID string, userID string) error
	GetAssignees(ctx context.Context, organizationID string, issueID string) ([]string, error)
	Lock(ctx context.Context, organizationID string, issueID issues.ID, reason issues.LockReason, lockedBy string, lockedAt time.Time) (*issues.Issue, error)
	Unlock(ctx context.Context, organizationID string, issueID issues.ID) (*issues.Issue, error)
}

type CommentRepository interface {
	Create(ctx context.Context, organizationID string, comment *comments.Comment) (*comments.Comment, error)
	List(ctx context.Context, organizationID string, resourceType comments.ResourceType, resourceID comments.ID) ([]*comments.Comment, error)
	Get(ctx context.Context, organizationID string, commentID comments.ID) (*comments.Comment, error)
	Update(ctx context.Context, organizationID string, comment *comments.Comment) (*comments.Comment, error)
	Delete(ctx context.Context, organizationID string, commentID comments.ID) error
	Minimize(ctx context.Context, organizationID string, commentID comments.ID, reason comments.MinimizedReason) (*comments.Comment, error)
	Unminimize(ctx context.Context, organizationID string, commentID comments.ID) (*comments.Comment, error)
}

type LabelRepository interface {
	Create(ctx context.Context, organizationID string, label *labels.Label) (*labels.Label, error)
	Get(ctx context.Context, organizationID string, labelID labels.ID) (*labels.Label, error)
	List(ctx context.Context, organizationID string, filter labels.ListFilter) ([]*labels.Label, error)
	Update(ctx context.Context, organizationID string, label *labels.Label) (*labels.Label, error)
	Delete(ctx context.Context, organizationID string, labelID labels.ID) error
	AddLabelToIssue(ctx context.Context, organizationID string, issueID string, labelID labels.ID) error
	RemoveLabelFromIssue(ctx context.Context, organizationID string, issueID string, labelID labels.ID) error
	GetLabelsForIssue(ctx context.Context, organizationID string, issueID string) ([]*labels.Label, error)
}

type MilestoneRepository interface {
	Create(ctx context.Context, organizationID string, milestone *milestones.Milestone) (*milestones.Milestone, error)
	Get(ctx context.Context, organizationID string, milestoneID milestones.ID) (*milestones.Milestone, error)
	List(ctx context.Context, organizationID, repository string, state milestones.State) ([]*milestones.Milestone, error)
	Update(ctx context.Context, organizationID string, milestone *milestones.Milestone) (*milestones.Milestone, error)
	Delete(ctx context.Context, organizationID string, milestoneID milestones.ID) error
	Close(ctx context.Context, organizationID string, milestoneID milestones.ID, closedAt time.Time) (*milestones.Milestone, error)
	SetMilestone(ctx context.Context, organizationID, issueID, milestoneID string) error
	ClearMilestone(ctx context.Context, organizationID, issueID string) error
	GetProgress(ctx context.Context, organizationID string, milestoneID milestones.ID) (*milestones.Progress, error)
}

type ReactionRepository interface {
	Add(ctx context.Context, organizationID string, reaction *reactions.Reaction) (*reactions.Reaction, error)
	List(ctx context.Context, organizationID string, reactableType reactions.ReactableType, reactableID reactions.ID) ([]*reactions.Reaction, error)
	Remove(ctx context.Context, organizationID string, reactionID reactions.ID) error
}

type EventRepository interface {
	Record(ctx context.Context, organizationID string, event *events.Event) error
	List(ctx context.Context, organizationID string, issueID string) ([]*events.Event, error)
	ListByType(ctx context.Context, organizationID string, issueID string, eventType events.EventType) ([]*events.Event, error)
}

type NotificationRepository interface {
	Create(ctx context.Context, organizationID string, notification *notifications.Notification) error
	List(ctx context.Context, organizationID string, userID string, unreadOnly bool, limit, offset int) ([]*notifications.Notification, int, error)
	MarkAsRead(ctx context.Context, organizationID string, notificationID notifications.ID, userID string) error
	MarkAllAsRead(ctx context.Context, organizationID string, userID string) error
	Delete(ctx context.Context, organizationID string, notificationID notifications.ID, userID string) error
	Subscribe(ctx context.Context, organizationID string, userID string, issueID string) error
	Unsubscribe(ctx context.Context, organizationID string, userID string, issueID string) error
	IsSubscribed(ctx context.Context, organizationID string, userID string, issueID string) (bool, error)
	GetSubscribers(ctx context.Context, organizationID string, issueID string) ([]string, error)
}

type DeliveryDependencies struct {
	Repository       delivery.Repository
	Identity         identity.PrincipalResolver
	RevokeSession    func(context.Context, string) error
	CSRF             identity.CSRFValidator
	AllowedOrigin    string
	OIDC             identity.OIDCHandler
	LocalAuth        LocalAuthHandler
	Membership       MembershipRepository
	Account          AccountRepository
	Settings         SettingsRepository
	Git              delivery.GitProvider
	IntegrationGit   delivery.IntegrationGitProvider
	Evaluator        delivery.Evaluator
	Evidence         delivery.EvidenceStore
	Reviewers        ReviewerAuthorizer
	WebhookDirectory string
	Runs             execution.Store
	Pipelines        pipeline.Store
	Catalog          delivery.RepositoryCatalog
	Preview          delivery.RepositoryPreviewReader
	Locker           delivery.ChangesetLocker
	Workspaces       workspace.Repository
	Tasks            *tasks.PostgresStore
	IssueRepo        IssueRepository
	CommentRepo      CommentRepository
	LabelRepo        LabelRepository
	MilestoneRepo    MilestoneRepository
	ReactionRepo     ReactionRepository
	EventRepo        EventRepository
	NotificationRepo NotificationRepository
}

type storedChangesetResponse struct {
	Changeset *delivery.Changeset `json:"changeset"`
	Status    string              `json:"status"`
	Version   int64               `json:"version"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
}

type changesetListResponse struct {
	Items  []storedChangesetResponse `json:"items"`
	Total  int                       `json:"total"`
	Limit  int                       `json:"limit"`
	Offset int                       `json:"offset"`
}

type createChangesetRequest struct {
	Repository   string  `json:"repository"`
	Title        string  `json:"title"`
	SourceBranch *string `json:"source_branch,omitempty"`
}

type problemResponse struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func newDeliveryHandler(deps DeliveryDependencies) http.Handler {
	mux := http.NewServeMux()
	deps.pipelineRoutes(mux)
	deps.executionRoutes(mux)
	deps.mergePreviewRoutes(mux)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/workspaces", deps.createWorkspace)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/workspaces/{workspaceID}", deps.getWorkspaceHandler)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/workspaces/{workspaceID}/tree", deps.listWorkspaceTree)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/workspaces/{workspaceID}/diff", deps.getWorkspaceDiff)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/workspaces/{workspaceID}/changesets", deps.createWorkspaceChangeset)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/workspaces/{workspaceID}/files", deps.readWorkspaceFile)
	mux.HandleFunc("PUT /api/v1/organizations/{organizationID}/workspaces/{workspaceID}/files", deps.writeWorkspaceFile)
	deps.taskExecutionRoutes(mux)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/members", deps.listMembers)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/members/{userID}", deps.updateMember)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/members/{userID}", deps.removeMember)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/invitations", deps.listInvitations)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/invitations", deps.createInvitation)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/invitations/{invitationID}", deps.revokeInvitation)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/membership-audit", deps.listMembershipAudit)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories", deps.listRepositories)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/refs", deps.listRepositoryRefs)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/tree", deps.listRepositoryTree)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/blob", deps.readRepositoryBlob)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/history", deps.listRepositoryHistory)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/compare", deps.compareRepositoryCommits)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/file-history", deps.listRepositoryFileHistory)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/blame", deps.blameRepositoryFile)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/repositories", deps.registerRepository)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/changesets", deps.listChangesets)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets", deps.createChangeset)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/changesets/{id}", deps.getChangeset)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/revisions", deps.addRevision)
	mux.HandleFunc("PUT /api/v1/organizations/{organizationID}/changesets/{id}/files", deps.saveChangesetFile)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/evaluations", deps.recordEvaluation)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/evidence", deps.attachEvidence)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/reviews", deps.submitReview)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/reviews/{reviewID}/decision", deps.decideReview)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/changesets/{id}/merge", deps.mergeChangeset)

	// Issue tracking routes
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/issues", deps.listIssues)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues", deps.createIssue)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/issues/{number}", deps.getIssue)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/issues/{number}", deps.updateIssue)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/close", deps.closeIssue)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/reopen", deps.reopenIssue)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/lock", deps.lockIssue)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/issues/{number}/lock", deps.unlockIssue)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/assignees", deps.addAssignees)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/issues/{number}/assignees", deps.removeAssignees)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/labels", deps.addLabelsToIssue)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/issues/{number}/labels/{labelName}", deps.removeLabelFromIssue)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/issues/{number}/timeline", deps.getIssueTimeline)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/issues/{number}/subscription", deps.getIssueSubscription)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/subscription", deps.subscribeToIssue)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/issues/{number}/subscription", deps.unsubscribeFromIssue)

	// Notification routes
	mux.HandleFunc("GET /api/v1/notifications", deps.listNotifications)
	mux.HandleFunc("PATCH /api/v1/notifications/{id}/read", deps.markNotificationAsRead)
	mux.HandleFunc("POST /api/v1/notifications/read-all", deps.markAllNotificationsAsRead)

	// Comment routes
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/issues/{number}/comments", deps.listComments)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/issues/{number}/comments", deps.createComment)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/comments/{commentID}", deps.getComment)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/comments/{commentID}", deps.updateComment)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/comments/{commentID}", deps.deleteComment)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/comments/{commentID}/minimize", deps.minimizeComment)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/comments/{commentID}/minimize", deps.unminimizeComment)

	// Reaction routes
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/comments/{commentID}/reactions", deps.listReactions)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/comments/{commentID}/reactions", deps.addReaction)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/comments/{commentID}/reactions/{reactionID}", deps.removeReaction)

	// Label routes
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels", deps.listLabels)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels", deps.createLabel)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels/{name}", deps.updateLabel)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/labels/{name}", deps.deleteLabel)

	// Milestone routes
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones", deps.listMilestones)
	mux.HandleFunc("POST /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones", deps.createMilestone)
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{milestoneID}", deps.getMilestone)
	mux.HandleFunc("PATCH /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{milestoneID}", deps.updateMilestone)
	mux.HandleFunc("DELETE /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/milestones/{milestoneID}", deps.deleteMilestone)

	return mux
}

type repositoryRegistrationRequest struct {
	Slug          string `json:"slug"`
	DefaultBranch string `json:"default_branch"`
}

func (d DeliveryDependencies) listRepositories(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.Catalog == nil {
		writeProblem(w, 503, "Repository catalog unavailable", "Repository metadata storage is not configured")
		return
	}
	items, err := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if err != nil {
		writeProblem(w, 500, "Unable to list repositories", "The repository catalog query failed")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Get("details") == "1" {
		writeJSON(w, 200, map[string]any{"items": d.repositorySummaries(r.Context(), principal.OrganizationID, items)})
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (d DeliveryDependencies) registerRepository(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, 403, "Insufficient permissions", "Only organization owners and administrators can register repositories")
		return
	}
	if d.Catalog == nil || d.Git == nil {
		writeProblem(w, 503, "Repository integration unavailable", "A repository catalog and trusted Git provider are required")
		return
	}
	var input repositoryRegistrationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Slug = strings.TrimSpace(input.Slug)
	input.DefaultBranch = strings.TrimSpace(input.DefaultBranch)
	if _, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, input.Slug, input.DefaultBranch); err != nil {
		writeProblem(w, 422, "Repository not available", "The repository must exist under the configured organization Git root and its default branch must resolve")
		return
	}
	item, err := d.Catalog.RegisterRepository(r.Context(), delivery.RepositoryMetadata{OrganizationID: principal.OrganizationID, Slug: input.Slug, DefaultBranch: input.DefaultBranch, CreatedBy: principal.UserID})
	if errors.Is(err, delivery.ErrVersionConflict) {
		writeProblem(w, 409, "Repository already registered", "This repository is already registered for the organization")
		return
	}
	if err != nil {
		writeProblem(w, 500, "Unable to register repository", "Repository metadata could not be persisted")
		return
	}
	writeJSON(w, 201, item)
}

// maxChangesetQueryLength bounds the free-text q filter, counted in characters.
const maxChangesetQueryLength = 200

func (d DeliveryDependencies) listChangesets(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return
	}
	limit, offset := 20, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid limit", "limit must be an integer")
			return
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "Invalid offset", "offset must be an integer")
			return
		}
	}
	values := r.URL.Query()
	filter := delivery.ListFilter{Repository: values.Get("repository"), Status: delivery.Lifecycle(values.Get("status")), Reviewer: values.Get("reviewer"), Query: values.Get("q")}
	if filter.Status != "" && !filter.Status.Valid() {
		writeProblem(w, http.StatusBadRequest, "Invalid status", "status must be one of draft, evaluation_pending, evaluation_failed, evidence_required, review_required, in_review, changes_requested, ready_to_merge, merged")
		return
	}
	if utf8.RuneCountInString(filter.Query) > maxChangesetQueryLength {
		writeProblem(w, http.StatusBadRequest, "Invalid query", fmt.Sprintf("q must be at most %d characters", maxChangesetQueryLength))
		return
	}
	if filter.Reviewer == "me" {
		filter.Reviewer = principal.UserID
	}
	items, total, err := d.Repository.List(r.Context(), principal.OrganizationID, filter, limit, offset)
	if errors.Is(err, delivery.ErrInvalidInput) {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", err.Error())
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list changesets", "The changeset query failed")
		return
	}
	response := changesetListResponse{Items: make([]storedChangesetResponse, 0, len(items)), Total: total, Limit: limit, Offset: offset}
	for _, item := range items {
		response.Items = append(response.Items, toChangesetResponse(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (d DeliveryDependencies) createChangeset(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return
	}
	var input createChangesetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "An identifier could not be generated")
		return
	}
	if d.Catalog != nil {
		repositories, catalogErr := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
		if catalogErr != nil {
			writeProblem(w, 503, "Repository catalog unavailable", "Registered repositories could not be verified")
			return
		}
		registered := false
		for _, repository := range repositories {
			if repository.Slug == strings.TrimSpace(input.Repository) {
				registered = true
				break
			}
		}
		if !registered {
			writeProblem(w, 422, "Repository is not registered", "Register this repository with the organization before creating a changeset")
			return
		}
	}
	changeset, err := delivery.NewChangeset(delivery.ID(id), strings.TrimSpace(input.Repository), strings.TrimSpace(input.Title), principal.UserID, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid changeset", err.Error())
		return
	}

	// When source_branch is provided, atomically save the initial revision
	if input.SourceBranch != nil && strings.TrimSpace(*input.SourceBranch) != "" {
		if d.Git == nil {
			writeProblem(w, http.StatusServiceUnavailable, "Git provider unavailable", "Configure the trusted Git provider before creating changesets with source branches")
			return
		}
		sourceBranch := strings.TrimSpace(*input.SourceBranch)
		revision, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, changeset.Repository, sourceBranch)
		if err != nil {
			writeProblem(w, http.StatusUnprocessableEntity, "Source branch unavailable", "The source branch could not be resolved in the configured repository")
			return
		}
		revisionID, err := newID()
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "Unable to create revision", "An identifier could not be generated")
			return
		}
		if err = changeset.AddGitRevision(delivery.ID(revisionID), revision.Ref, revision.CommitSHA, revision.ParentSHA, principal.UserID, time.Now().UTC()); err != nil {
			writeDeliveryError(w, err)
			return
		}
	}

	stored, err := d.Repository.Create(r.Context(), principal.OrganizationID, changeset)
	if errors.Is(err, delivery.ErrVersionConflict) {
		writeProblem(w, http.StatusConflict, "Changeset conflict", "A changeset with this identifier already exists in this organization")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create changeset", "The changeset could not be persisted")
		return
	}
	writeJSON(w, http.StatusCreated, toChangesetResponse(stored))
}

func (d DeliveryDependencies) getChangeset(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(stored))
}

func (d DeliveryDependencies) addRevision(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	if d.Git == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Git provider unavailable", "Configure the trusted local Git provider before creating revisions")
		return
	}
	var input struct {
		Ref string `json:"ref"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	revision, err := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, stored.Changeset.Repository, input.Ref)
	if err != nil {
		writeProblem(w, http.StatusUnprocessableEntity, "Git revision unavailable", "The requested ref could not be resolved in the organization's configured repository")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to create revision", "An identifier could not be generated")
		return
	}
	if err = stored.Changeset.AddGitRevision(delivery.ID(id), revision.Ref, revision.CommitSHA, revision.ParentSHA, principal.UserID, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) saveChangesetFile(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	writer, supported := d.Git.(delivery.RepositoryFileWriter)
	if !supported {
		writeProblem(w, http.StatusServiceUnavailable, "Repository editing unavailable", "The configured Git provider does not support safe changeset writes")
		return
	}
	if d.Preview == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Repository preview unavailable", "A trusted repository preview reader is required to verify the base blob")
		return
	}
	var input struct {
		Path          string `json:"path"`
		BaseCommitSHA string `json:"base_commit_sha"`
		BaseBlobSHA   string `json:"base_blob_sha"`
		Content       string `json:"content"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if len(input.Content) > 1<<20 || !utf8.ValidString(input.Content) {
		writeProblem(w, http.StatusRequestEntityTooLarge, "File content too large or invalid", "WebIDE accepts UTF-8 text files up to 1 MiB")
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	if stored.Changeset.Merge != nil {
		writeProblem(w, http.StatusConflict, "Changeset already merged", "A merged changeset cannot receive additional file revisions")
		return
	}
	revision, exists := stored.Changeset.CurrentRevision()
	if !exists || revision.CommitSHA == "" {
		writeProblem(w, http.StatusConflict, "Revision required", "Resolve an initial Git revision before editing files")
		return
	}
	if input.BaseCommitSHA != revision.CommitSHA {
		writeProblem(w, http.StatusConflict, "Stale editor revision", "The changeset revision advanced; reload the file before saving")
		return
	}
	_, currentBlob, readErr := d.Preview.ReadBlob(r.Context(), principal.OrganizationID, stored.Changeset.Repository, revision.CommitSHA, input.Path, 1<<20)
	if readErr != nil || currentBlob != input.BaseBlobSHA {
		writeProblem(w, http.StatusConflict, "Stale file content", "The file changed or is not a regular text blob at the current changeset revision")
		return
	}
	result, err := writer.SaveTextFile(r.Context(), principal.OrganizationID, stored.Changeset.Repository, string(stored.Changeset.ID), revision.CommitSHA, input.BaseBlobSHA, input.Path, []byte(input.Content))
	if errors.Is(err, delivery.ErrWriteConflict) {
		writeProblem(w, http.StatusConflict, "Concurrent file update", "The changeset branch or file changed while saving; reload and reapply your edits")
		return
	}
	if errors.Is(err, delivery.ErrWriteInvalid) {
		writeProblem(w, http.StatusBadRequest, "Invalid file update", "Only normalized paths to existing regular UTF-8 text files up to 1 MiB can be edited")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Unable to save file", "The trusted Git provider could not complete the lease-protected write")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to record file revision", "An identifier could not be generated")
		return
	}
	if err = stored.Changeset.AddGitRevision(delivery.ID(id), result.Branch, result.CommitSHA, revision.CommitSHA, principal.UserID, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"changeset":  toChangesetResponse(updated),
		"path":       input.Path,
		"branch":     result.Branch,
		"commit_sha": result.CommitSHA,
		"blob_sha":   result.BlobSHA,
	})
}

func (d DeliveryDependencies) recordEvaluation(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	if d.Evaluator == nil || d.Git == nil {
		writeProblem(w, 503, "Evaluation worker unavailable", "A trusted evaluation adapter and Git provider are required")
		return
	}
	if d.Evidence == nil {
		writeProblem(w, 503, "Evidence storage unavailable", "A content-addressed evidence store is not configured")
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	revision, exists := stored.Changeset.CurrentRevision()
	if !exists || revision.CommitSHA == "" {
		writeProblem(w, 409, "Revision required", "Resolve a Git commit before evaluating this changeset")
		return
	}
	if d.Catalog == nil {
		writeProblem(w, 503, "Repository catalog unavailable", "The target branch cannot be verified")
		return
	}
	repositories, catalogErr := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if catalogErr != nil {
		writeProblem(w, 503, "Repository catalog unavailable", "The target branch could not be loaded")
		return
	}
	baseRef := ""
	for _, repository := range repositories {
		if repository.Slug == stored.Changeset.Repository {
			baseRef = repository.DefaultBranch
			break
		}
	}
	if baseRef == "" {
		writeProblem(w, 409, "Repository not registered", "Register this repository before evaluating changesets")
		return
	}
	baseRevision, baseErr := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, stored.Changeset.Repository, baseRef)
	if baseErr != nil {
		writeProblem(w, 409, "Target branch unavailable", "The registered default branch could not be resolved")
		return
	}
	evaluationID, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to create evaluation job", "An identifier could not be generated")
		return
	}
	job := delivery.EvaluationJob{ID: evaluationID, OrganizationID: principal.OrganizationID, ChangesetID: stored.Changeset.ID, RevisionID: revision.ID, Repository: stored.Changeset.Repository, BaseSHA: baseRevision.CommitSHA, RevisionSHA: revision.CommitSHA}
	result, evalErr := d.Evaluator.Evaluate(r.Context(), job)
	if result.JobID != job.ID || result.OrganizationID != job.OrganizationID || result.ChangesetID != job.ChangesetID || result.RevisionID != job.RevisionID || result.BaseSHA != job.BaseSHA || result.RevisionSHA != job.RevisionSHA {
		writeProblem(w, 502, "Invalid evaluation result", "The trusted evaluator returned a result that does not match the server-issued job identity and immutable revision")
		return
	}
	status := delivery.EvaluationPassed
	if evalErr != nil || !result.Passed {
		status = delivery.EvaluationFailed
	}
	if err = stored.Changeset.RecordEvaluationAgainstBase(delivery.ID(evaluationID), revision.ID, baseRevision.CommitSHA, status, result.Summary, principal.UserID, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	if len(result.Report) > 0 {
		artifact, putErr := d.Evidence.Put(r.Context(), principal.OrganizationID, string(stored.Changeset.ID), result.Report)
		if putErr != nil {
			writeProblem(w, 503, "Evidence storage failed", "The evaluation report could not be persisted")
			return
		}
		if status == delivery.EvaluationPassed {
			evidenceID, idErr := newID()
			if idErr != nil {
				writeProblem(w, 500, "Unable to record evidence", "An identifier could not be generated")
				return
			}
			if err = stored.Changeset.AttachEvidenceArtifact(delivery.ID(evidenceID), revision.ID, delivery.ID(evaluationID), "evaluation-report", artifact.URI, artifact.SHA256, artifact.Size, principal.UserID, time.Now().UTC()); err != nil {
				writeDeliveryError(w, err)
				return
			}
		}
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) attachEvidence(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	if d.Evidence == nil {
		writeProblem(w, 503, "Evidence storage unavailable", "A content-addressed evidence store is not configured")
		return
	}
	var input struct {
		EvaluationID string `json:"evaluation_id"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	revision, exists := stored.Changeset.CurrentRevision()
	if !exists {
		writeProblem(w, 409, "Revision required", "A current revision is required")
		return
	}
	var report []byte
	for _, evaluation := range stored.Changeset.Evaluations {
		if string(evaluation.ID) == input.EvaluationID && evaluation.RevisionID == revision.ID && evaluation.Status == delivery.EvaluationPassed {
			report, _ = json.Marshal(evaluation)
		}
	}
	if len(report) == 0 {
		writeProblem(w, 409, "Passed evaluation required", "Evidence can only be derived from a persisted passing evaluation for the current revision")
		return
	}
	artifact, err := d.Evidence.Put(r.Context(), principal.OrganizationID, string(stored.Changeset.ID), report)
	if err != nil {
		writeProblem(w, 503, "Evidence storage failed", "The evidence artifact could not be persisted")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to attach evidence", "An identifier could not be generated")
		return
	}
	if err = stored.Changeset.AttachEvidenceArtifact(delivery.ID(id), revision.ID, delivery.ID(input.EvaluationID), "evaluation-report", artifact.URI, artifact.SHA256, artifact.Size, principal.UserID, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) submitReview(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	if d.Reviewers == nil {
		writeProblem(w, 503, "Review assignment unavailable", "Organization membership verification is not configured")
		return
	}
	var input struct {
		ReviewerID string `json:"reviewer_id"`
		Comment    string `json:"comment"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	active, err := d.Reviewers.IsActiveMember(r.Context(), principal.OrganizationID, input.ReviewerID)
	if err != nil {
		writeProblem(w, 503, "Review assignment unavailable", "The reviewer membership could not be verified")
		return
	}
	if !active {
		writeProblem(w, 422, "Invalid reviewer", "The assigned reviewer must be an active member of this organization")
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	revision, exists := stored.Changeset.CurrentRevision()
	if !exists {
		writeProblem(w, 409, "Revision required", "A current revision is required")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to assign review", "An identifier could not be generated")
		return
	}
	if err = stored.Changeset.AssignReview(delivery.ID(id), revision.ID, input.ReviewerID, principal.UserID, input.Comment, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toChangesetResponse(updated))
}

func (d DeliveryDependencies) decideReview(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	var input struct {
		Approved bool   `json:"approved"`
		Comment  string `json:"comment"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	if err := stored.Changeset.DecideReview(delivery.ID(r.PathValue("reviewID")), input.Approved, principal.UserID, input.Comment, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) mergeChangeset(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	unlock, locked := d.lockChangeset(w, r, principal.OrganizationID)
	if !locked {
		return
	}
	defer unlock()
	if d.Git == nil {
		writeProblem(w, 503, "Git provider unavailable", "A trusted Git provider is not configured")
		return
	}
	var input struct {
		TargetRef string `json:"target_ref"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stored, ok := d.load(w, r, principal.OrganizationID)
	if !ok {
		return
	}
	if d.Catalog == nil {
		writeProblem(w, 503, "Repository catalog unavailable", "The merge target cannot be verified")
		return
	}
	repositories, catalogErr := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if catalogErr != nil {
		writeProblem(w, 503, "Repository catalog unavailable", "The merge target could not be loaded")
		return
	}
	allowedTarget := ""
	for _, repository := range repositories {
		if repository.Slug == stored.Changeset.Repository {
			allowedTarget = repository.DefaultBranch
			break
		}
	}
	if allowedTarget == "" || input.TargetRef != allowedTarget {
		writeProblem(w, 422, "Invalid merge target", "Changesets can only merge into the registered default branch")
		return
	}
	revision, exists := stored.Changeset.CurrentRevision()
	if !exists || revision.CommitSHA == "" {
		writeProblem(w, 409, "Revision required", "A resolved Git revision is required")
		return
	}
	if err := stored.Changeset.ValidateMerge(); err != nil {
		writeDeliveryError(w, err)
		return
	}
	if d.Locker == nil {
		writeProblem(w, 503, "Repository merge lock unavailable", "A distributed repository lock is required before merging")
		return
	}
	unlockRepository, lockErr := d.Locker.LockChangeset(r.Context(), principal.OrganizationID, "repository:"+stored.Changeset.Repository)
	if lockErr != nil {
		writeProblem(w, 503, "Repository merge lock unavailable", "The repository could not be safely locked for merge")
		return
	}
	defer unlockRepository()
	baseRevision, baseErr := d.Git.ResolveRevision(r.Context(), principal.OrganizationID, stored.Changeset.Repository, allowedTarget)
	if baseErr != nil {
		writeProblem(w, 409, "Target branch unavailable", "The registered default branch could not be resolved under the merge lock")
		return
	}
	currentEvaluation, hasEvaluation := stored.Changeset.LatestEvaluation(revision.ID)
	if !hasEvaluation || currentEvaluation.Status != delivery.EvaluationPassed || currentEvaluation.BaseSHA == "" || currentEvaluation.BaseSHA != baseRevision.CommitSHA {
		writeProblem(w, 409, "Evaluation is stale", "The target branch changed after evaluation; rerun trusted evaluation before merging")
		return
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, 500, "Unable to record merge", "An identifier could not be generated")
		return
	}
	merged, err := d.Git.MergeRevision(r.Context(), principal.OrganizationID, stored.Changeset.Repository, revision.CommitSHA, input.TargetRef)
	if err != nil {
		writeProblem(w, 409, "Git merge rejected", "The target branch could not be merged cleanly; no merge record was written")
		return
	}
	if err = stored.Changeset.CompleteMerge(delivery.ID(id), principal.UserID, merged.TargetRef, merged.CommitSHA, time.Now().UTC()); err != nil {
		writeDeliveryError(w, err)
		return
	}
	updated, err := d.Repository.Update(r.Context(), principal.OrganizationID, stored.Changeset, stored.Version)
	if err != nil {
		writeRepositoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toChangesetResponse(updated))
}

func (d DeliveryDependencies) load(w http.ResponseWriter, r *http.Request, organizationID string) (delivery.StoredChangeset, bool) {
	if d.Repository == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Delivery storage unavailable", "The delivery repository is not configured")
		return delivery.StoredChangeset{}, false
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid changeset ID", "A changeset ID is required")
		return delivery.StoredChangeset{}, false
	}
	stored, err := d.Repository.Get(r.Context(), organizationID, delivery.ID(id))
	if errors.Is(err, delivery.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "Changeset not found", "No changeset exists in the selected organization")
		return delivery.StoredChangeset{}, false
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to load changeset", "The changeset query failed")
		return delivery.StoredChangeset{}, false
	}
	return stored, true
}

func (d DeliveryDependencies) principal(w http.ResponseWriter, r *http.Request, write bool) (Principal, bool) {
	organizationID := strings.TrimSpace(r.PathValue("organizationID"))
	if organizationID == "" {
		writeProblem(w, http.StatusBadRequest, "Organization required", "An organization ID is required")
		return Principal{}, false
	}
	if d.Identity == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Authentication unavailable", "A trusted identity and organization membership provider is not configured")
		return Principal{}, false
	}
	principal, err := d.Identity.ResolvePrincipal(r, organizationID)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid authenticated identity and active organization membership are required")
		return Principal{}, false
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Identity service unavailable", "The authenticated identity could not be verified")
		return Principal{}, false
	}
	// The path segment is an organization handle (id or slug). ResolvePrincipal maps it to a canonical
	// organization and every query below uses principal.OrganizationID, but the handler still checks
	// that the resolver returned the organization the URL names, so a resolver bug can never serve
	// another tenant's data.
	if strings.TrimSpace(principal.UserID) == "" || !principalNamedBy(principal, organizationID) {
		writeProblem(w, http.StatusForbidden, "Organization access denied", "The authenticated principal is not authorized for the selected organization")
		return Principal{}, false
	}
	switch principal.Role {
	case "owner", "admin", "member":
		return principal, true
	case "viewer":
		if !write {
			return principal, true
		}
	default:
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The organization role does not permit this operation")
		return Principal{}, false
	}
	if write {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "The viewer role cannot modify delivery resources")
		return Principal{}, false
	}
	return principal, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		writeProblem(w, http.StatusBadRequest, "Invalid request body", "Only one JSON value is allowed")
		return false
	}
	return true
}

func toChangesetResponse(stored delivery.StoredChangeset) storedChangesetResponse {
	return storedChangesetResponse{Changeset: stored.Changeset, Status: string(stored.Changeset.Lifecycle()), Version: stored.Version, CreatedAt: stored.CreatedAt, UpdatedAt: stored.UpdatedAt}
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate identifier: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problemResponse{Type: "about:blank", Title: title, Status: status, Detail: detail})
}

type updateMemberRequest struct {
	Role   *string `json:"role,omitempty"`
	Status *string `json:"status,omitempty"`
}

func (d DeliveryDependencies) membershipAdmin(w http.ResponseWriter, r *http.Request) (Principal, bool) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return Principal{}, false
	}
	if principal.Role != "owner" && principal.Role != "admin" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners and administrators can manage members")
		return Principal{}, false
	}
	if d.Membership == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Membership management unavailable", "The organization membership repository is not configured")
		return Principal{}, false
	}
	return principal, true
}

func (d DeliveryDependencies) listMembers(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
	}
	if err == nil {
		if raw := r.URL.Query().Get("offset"); raw != "" {
			offset, err = strconv.Atoi(raw)
		}
	}
	if err != nil || limit < 1 || limit > 100 || offset < 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", "limit must be 1-100 and offset must be zero or greater")
		return
	}
	members, err := d.Membership.ListMembers(r.Context(), principal.OrganizationID, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list members", "The organization membership query failed")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items  []identity.OrganizationMember `json:"items"`
		Limit  int                           `json:"limit"`
		Offset int                           `json:"offset"`
	}{Items: members, Limit: limit, Offset: offset})
}

func (d DeliveryDependencies) updateMember(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	var input updateMemberRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Role == nil && input.Status == nil {
		writeProblem(w, http.StatusBadRequest, "Invalid membership update", "At least one of role or status is required")
		return
	}
	member, err := d.Membership.UpdateMembership(r.Context(), principal.OrganizationID, principal.UserID, r.PathValue("userID"), input.Role, input.Status)
	if err != nil {
		writeMembershipError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, member)
}

func (d DeliveryDependencies) removeMember(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	if err := d.Membership.RemoveMembership(r.Context(), principal.OrganizationID, principal.UserID, r.PathValue("userID")); err != nil {
		writeMembershipError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeMembershipError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, identity.ErrMembershipNotFound):
		writeProblem(w, http.StatusNotFound, "Member not found", "No active membership exists for this user in the selected organization")
	case errors.Is(err, identity.ErrMembershipForbidden):
		writeProblem(w, http.StatusForbidden, "Membership operation forbidden", "Your organization role cannot perform this membership operation")
	case errors.Is(err, identity.ErrLastActiveOwner):
		writeProblem(w, http.StatusConflict, "Last owner protected", "An organization must retain at least one active owner")
	case errors.Is(err, identity.ErrInvalidMembershipChange):
		writeProblem(w, http.StatusBadRequest, "Invalid membership change", "The requested role or membership status is invalid or unchanged")
	default:
		writeProblem(w, http.StatusInternalServerError, "Membership update failed", "The organization membership change could not be completed")
	}
}

type createInvitationRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (d DeliveryDependencies) invitationPage(w http.ResponseWriter, r *http.Request) (Principal, int, int, bool) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return Principal{}, 0, 0, false
	}
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
	}
	if err == nil {
		if raw := r.URL.Query().Get("offset"); raw != "" {
			offset, err = strconv.Atoi(raw)
		}
	}
	if err != nil || limit < 1 || limit > 100 || offset < 0 {
		writeProblem(w, http.StatusBadRequest, "Invalid pagination", "limit must be 1-100 and offset must be zero or greater")
		return Principal{}, 0, 0, false
	}
	return principal, limit, offset, true
}

func (d DeliveryDependencies) listInvitations(w http.ResponseWriter, r *http.Request) {
	principal, limit, offset, ok := d.invitationPage(w, r)
	if !ok {
		return
	}
	items, err := d.Membership.ListInvitations(r.Context(), principal.OrganizationID, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to list invitations", "The organization invitation query failed")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items  []identity.OrganizationInvitation `json:"items"`
		Limit  int                               `json:"limit"`
		Offset int                               `json:"offset"`
	}{items, limit, offset})
}

func (d DeliveryDependencies) createInvitation(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	var input createInvitationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	token, err := identity.GenerateToken()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to create invitation", "A secure invitation token could not be generated")
		return
	}
	expiresAt := time.Now().UTC().Add(7 * 24 * time.Hour)
	invitation, err := d.Membership.CreateInvitation(r.Context(), principal.OrganizationID, principal.UserID, input.Email, input.Role, identity.HashToken(token), expiresAt)
	if err != nil {
		writeInvitationError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		Invitation    identity.OrganizationInvitation `json:"invitation"`
		InvitationURL string                          `json:"invitation_url"`
		Token         string                          `json:"token"`
	}{invitation, strings.TrimRight(d.AllowedOrigin, "/") + "/auth/invitations/accept?token=" + url.QueryEscape(token), token})
}

func (d DeliveryDependencies) revokeInvitation(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.membershipAdmin(w, r)
	if !ok {
		return
	}
	if err := d.Membership.RevokeInvitation(r.Context(), principal.OrganizationID, principal.UserID, r.PathValue("invitationID")); err != nil {
		writeInvitationError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) listMembershipAudit(w http.ResponseWriter, r *http.Request) {
	principal, limit, offset, ok := d.invitationPage(w, r)
	if !ok {
		return
	}
	events, err := d.Membership.ListMembershipAudit(r.Context(), principal.OrganizationID, limit, offset)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to load membership audit", "The organization audit query failed")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Items  []identity.MembershipAuditEvent `json:"items"`
		Limit  int                             `json:"limit"`
		Offset int                             `json:"offset"`
	}{events, limit, offset})
}

func writeInvitationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, identity.ErrInvitationNotFound):
		writeProblem(w, http.StatusNotFound, "Invitation not found", "The invitation is expired, revoked, accepted, or does not belong to this organization")
	case errors.Is(err, identity.ErrInvitationAlreadyMember):
		writeProblem(w, http.StatusConflict, "Already a member", "This verified email already belongs to an active or suspended organization member")
	case errors.Is(err, identity.ErrInvitationPending):
		writeProblem(w, http.StatusConflict, "Invitation already pending", "A pending invitation already exists for this email in this organization")
	case errors.Is(err, identity.ErrMembershipForbidden):
		writeProblem(w, http.StatusForbidden, "Invitation operation forbidden", "Your organization role cannot perform this invitation operation")
	case errors.Is(err, identity.ErrInvalidInvitation):
		writeProblem(w, http.StatusBadRequest, "Invalid invitation", "Provide a valid email and an allowed organization role")
	default:
		writeProblem(w, http.StatusInternalServerError, "Invitation operation failed", "The organization invitation could not be processed")
	}
}

func (d DeliveryDependencies) logout(w http.ResponseWriter, r *http.Request) {
	if d.RevokeSession == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Logout unavailable", "Session storage is not configured")
		return
	}
	if cookie, err := r.Cookie(identity.SessionCookieName); err == nil && cookie.Value != "" {
		if err := d.RevokeSession(r.Context(), cookie.Value); err != nil && !errors.Is(err, identity.ErrUnauthenticated) {
			writeProblem(w, http.StatusServiceUnavailable, "Logout temporarily unavailable", "The active session could not be revoked")
			return
		}
	}
	sessionCookie, csrfCookie := identity.ClearSessionCookies()
	http.SetCookie(w, sessionCookie)
	http.SetCookie(w, csrfCookie)
	w.WriteHeader(http.StatusNoContent)
}

func (d DeliveryDependencies) currentAccount(w http.ResponseWriter, r *http.Request) {
	if d.Account == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Account context unavailable", "The authenticated account repository is not configured")
		return
	}
	cookie, err := r.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session is required")
		return
	}
	account, err := d.Account.CurrentAccount(r.Context(), cookie.Value)
	if errors.Is(err, identity.ErrUnauthenticated) {
		writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid application session with active organization membership is required")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Account context unavailable", "The authenticated account and organization context could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

// getProfile returns the current user's profile information
func (d DeliveryDependencies) getProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	profile, err := d.Settings.GetUserProfile(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Profile unavailable", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, profile)
}

// updateProfile updates the current user's profile information
func (d DeliveryDependencies) updateProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}

	var patch struct {
		DisplayName *string `json:"display_name"`
		Bio         *string `json:"bio"`
		Location    *string `json:"location"`
	}
	if !decodeJSON(w, r, &patch) {
		return
	}
	if patch.DisplayName != nil && (strings.TrimSpace(*patch.DisplayName) == "" || len(*patch.DisplayName) > 100) {
		writeProblem(w, http.StatusBadRequest, "Invalid display name", "display_name must be nonblank and at most 100 bytes")
		return
	}

	profile, err := d.Settings.UpdateUserProfile(r.Context(), userID, patch.DisplayName, patch.Bio, patch.Location)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Profile update failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, profile)
}

func writeDeliveryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, delivery.ErrRevisionNotCurrent), errors.Is(err, delivery.ErrEvaluationRequired), errors.Is(err, delivery.ErrEvidenceRequired), errors.Is(err, delivery.ErrReviewRequired), errors.Is(err, delivery.ErrAlreadyMerged):
		writeProblem(w, http.StatusConflict, "Delivery precondition failed", err.Error())
	case errors.Is(err, delivery.ErrReviewAlreadyApproved):
		writeProblem(w, http.StatusConflict, "Review already approved", "The current revision already has an approved review. Add a new revision to request another review.")
	case errors.Is(err, delivery.ErrReviewForbidden):
		writeProblem(w, http.StatusForbidden, "Review decision forbidden", err.Error())
	case errors.Is(err, delivery.ErrInvalidInput):
		writeProblem(w, http.StatusBadRequest, "Invalid delivery operation", err.Error())
	default:
		writeProblem(w, http.StatusUnprocessableEntity, "Delivery operation rejected", err.Error())
	}
}
func writeRepositoryError(w http.ResponseWriter, err error) {
	if errors.Is(err, delivery.ErrVersionConflict) {
		writeProblem(w, http.StatusConflict, "Changeset changed concurrently", "Reload the changeset and retry the operation")
		return
	}
	if errors.Is(err, delivery.ErrNotFound) {
		writeProblem(w, http.StatusNotFound, "Changeset not found", "The changeset does not exist in this organization")
		return
	}
	writeProblem(w, http.StatusInternalServerError, "Unable to persist delivery state", "The changeset state could not be saved")
}

func (d DeliveryDependencies) lockChangeset(w http.ResponseWriter, r *http.Request, organizationID string) (func(), bool) {
	if d.Locker == nil {
		return func() {}, true
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeProblem(w, http.StatusBadRequest, "Changeset ID required", "A changeset identifier is required")
		return nil, false
	}
	unlock, err := d.Locker.LockChangeset(r.Context(), organizationID, id)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Changeset lock unavailable", "The changeset could not be safely locked for mutation")
		return nil, false
	}
	return unlock, true
}
