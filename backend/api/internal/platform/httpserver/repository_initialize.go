package httpserver

import (
	"errors"
	"net/http"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func (d DeliveryDependencies) initializeRepository(w http.ResponseWriter, r *http.Request, principal Principal, input repositoryRegistrationRequest) {
	initializer, ok := d.Git.(delivery.RepositoryInitializer)
	if !ok {
		writeProblem(w, 503, "Repository initialization unavailable", "The configured Git provider cannot create a repository")
		return
	}
	if input.DefaultBranch != "main" {
		writeProblem(w, 422, "Invalid default branch", "New repositories use the main branch")
		return
	}
	if input.Visibility == "public" || input.Fork {
		writeProblem(w, 422, "Invalid repository metadata", "New repositories are private and cannot be marked as forks")
		return
	}
	items, err := d.Catalog.ListRepositories(r.Context(), principal.OrganizationID)
	if err != nil {
		writeProblem(w, 500, "Unable to check repository name", "The repository catalog query failed")
		return
	}
	for _, item := range items {
		if item.Slug == input.Slug {
			writeProblem(w, 409, "Repository already registered", "This repository is already registered for the organization")
			return
		}
	}
	init := delivery.RepositoryInitialization{
		Description: input.Description, Readme: input.Initialize.Readme, Gitignore: input.Initialize.Gitignore, License: input.Initialize.License,
		IncludeAllBranches: input.Initialize.IncludeAllBranches,
	}
	if init.IncludeAllBranches && input.Initialize.Template == "" {
		writeProblem(w, 422, "Invalid template configuration", "Select a template repository to include all branches")
		return
	}
	if input.Initialize.Template != "" {
		if init.Readme || init.Gitignore != "" || init.License != "" || input.Initialize.Template == input.Slug {
			writeProblem(w, 422, "Invalid template configuration", "Choose a template repository or starter files")
			return
		}
		template, found := d.resolveRegisteredRepository(w, r, principal, input.Initialize.Template)
		if !found {
			return
		}
		if !template.IsTemplate || d.repositoryHostingKind(r.Context(), template) != "hosted" {
			writeProblem(w, 422, "Template repository unavailable", "Select an enabled native Git template in this organization")
			return
		}
		init.Template = template
		input.DefaultBranch = template.DefaultBranch
	}
	_, err = initializer.InitializeRepository(r.Context(), principal.OrganizationID, input.Slug, init)
	switch {
	case errors.Is(err, delivery.ErrVersionConflict):
		writeProblem(w, 409, "Repository path already exists", "A repository already exists at that path")
		return
	case errors.Is(err, delivery.ErrPreviewTooLarge):
		writeProblem(w, 422, "Template has too many branches", "Choose the default branch or a template with at most 1000 branches")
		return
	case errors.Is(err, delivery.ErrRepositoryInvalid):
		writeProblem(w, 422, "Invalid repository configuration", "Check the repository name and starter files")
		return
	case err != nil:
		writeProblem(w, 500, "Unable to initialize repository", "The local Git repository could not be created")
		return
	}
	item, err := d.Catalog.RegisterRepository(r.Context(), delivery.RepositoryMetadata{
		OrganizationID: principal.OrganizationID, Slug: input.Slug, DefaultBranch: input.DefaultBranch, CreatedBy: principal.UserID, Description: input.Description, Visibility: "private",
	})
	if errors.Is(err, delivery.ErrVersionConflict) {
		// A concurrent registration can have registered the Git repository just created here.
		writeProblem(w, 409, "Repository already registered", "This repository is already registered for the organization")
		return
	}
	if err != nil {
		// A failed database request may already have committed. Preserve Git data for recovery by registration.
		writeProblem(w, 500, "Unable to register repository", "Git initialization succeeded but registration could not be verified")
		return
	}
	writeJSON(w, 201, item)
}
