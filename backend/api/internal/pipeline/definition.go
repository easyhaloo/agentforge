// Package pipeline owns workflow definitions and their publication contract.
package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const APIVersion = "agentforge.dev/v1"
const Approval = "control/approval@v1"
const ContainerCheck = "container/check@v1"

var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var ErrMissing = errors.New("pipeline not found")
var ErrConflict = errors.New("pipeline revision or lifecycle conflict")

type Definition struct {
	APIVersion string      `json:"apiVersion"`
	Name       string      `json:"name"`
	Parameters []Parameter `json:"parameters,omitempty"`
	Stages     []Stage     `json:"stages"`
}
type Stage struct {
	ID        string   `json:"id"`
	DependsOn []string `json:"dependsOn"`
	Jobs      []Job    `json:"jobs"`
}
type Job struct {
	ID    string `json:"id"`
	Steps []Step `json:"steps"`
}
type Step struct {
	ID   string `json:"id"`
	Uses string `json:"uses"`
}
type Parameter struct {
	Name     string          `json:"name"`
	Type     string          `json:"type"`
	Required bool            `json:"required,omitempty"`
	Override bool            `json:"override,omitempty"`
	Default  json.RawMessage `json:"default,omitempty"`
	Choices  []string        `json:"choices,omitempty"`
}

func (d Definition) Validate() error {
	if d.APIVersion != APIVersion || !identifier.MatchString(d.Name) {
		return errors.New("provide apiVersion agentforge.dev/v1 and a valid workflow name")
	}
	if len(d.Stages) < 1 || len(d.Stages) > 64 || len(d.Parameters) > 64 {
		return errors.New("expected 1–64 stages and at most 64 parameters")
	}
	ids := map[string]bool{}
	graph := map[string][]string{}
	register := func(id string) bool {
		if !identifier.MatchString(id) || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for i, s := range d.Stages {
		if !register(s.ID) || len(s.Jobs) < 1 || len(s.Jobs) > 64 {
			return errors.New("invalid stage ID or job count")
		}
		deps := s.DependsOn
		if deps == nil && i > 0 {
			deps = []string{d.Stages[i-1].ID}
		}
		graph[s.ID] = deps
		for _, j := range s.Jobs {
			if !register(j.ID) || len(j.Steps) < 1 || len(j.Steps) > 64 {
				return errors.New("invalid job ID or step count")
			}
			for _, step := range j.Steps {
				if !register(step.ID) || (step.Uses != Approval && step.Uses != ContainerCheck) {
					return errors.New("invalid step ID or unknown capability")
				}
			}
		}
	}
	visited := map[string]int{}
	var visit func(string) bool
	visit = func(id string) bool {
		deps, ok := graph[id]
		if !ok || visited[id] == 1 {
			return false
		}
		if visited[id] == 2 {
			return true
		}
		visited[id] = 1
		seen := map[string]bool{}
		for _, dep := range deps {
			if seen[dep] || !visit(dep) {
				return false
			}
			seen[dep] = true
		}
		visited[id] = 2
		return true
	}
	for id := range graph {
		if !visit(id) {
			return errors.New("stage dependencies must be unique and name an acyclic graph of existing stages")
		}
	}
	names := map[string]bool{}
	for _, p := range d.Parameters {
		if !identifier.MatchString(p.Name) || names[p.Name] {
			return errors.New("duplicate or invalid parameter name")
		}
		names[p.Name] = true
		if !slices.Contains([]string{"string", "boolean", "number", "integer", "choice", "branch", "branches", "repository", "secretRef"}, p.Type) {
			return errors.New("unknown parameter type")
		}
		if (p.Type == "choice") != (len(p.Choices) > 0) || len(p.Choices) > 64 {
			return errors.New("only choice parameters accept a nonempty list of choices")
		}
		seen := map[string]bool{}
		for _, c := range p.Choices {
			if !safeString(c) || c == "" || seen[c] {
				return errors.New("invalid or duplicate choice")
			}
			seen[c] = true
		}
		if p.Default != nil && !p.accepts(p.Default) {
			return fmt.Errorf("invalid default for %s", p.Name)
		}
		if p.Required && !p.Override && p.Default == nil {
			return errors.New("required parameters need a default or runtime override")
		}
	}
	return nil
}
func safeString(s string) bool { return len(s) <= 1024 && !strings.ContainsRune(s, 0) }

var branchName = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,254}$`)

func validBranch(s string) bool {
	if !branchName.MatchString(s) || s == "HEAD" || strings.Contains(s, "..") || strings.HasSuffix(s, ".") {
		return false
	}
	for _, part := range strings.Split(s, "/") {
		if part == "" || strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	return true
}
func (p Parameter) accepts(raw json.RawMessage) bool {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return false
	}
	s, _ := v.(string)
	switch p.Type {
	case "string":
		_, ok := v.(string)
		return ok && safeString(s)
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "integer":
		n, err := strconv.ParseInt(string(raw), 10, 64)
		return err == nil && n >= -9007199254740991 && n <= 9007199254740991
	case "number":
		_, ok := v.(float64)
		return ok
	case "choice":
		return slices.Contains(p.Choices, s)
	case "branch":
		return validBranch(s)
	case "branches":
		a, ok := v.([]any)
		if !ok || len(a) == 0 || len(a) > 64 {
			return false
		}
		for _, b := range a {
			s, _ := b.(string)
			if !validBranch(s) {
				return false
			}
		}
		return true
	case "repository":
		owner, repo, ok := strings.Cut(s, "/")
		return ok && identifier.MatchString(owner) && identifier.MatchString(repo)
	case "secretRef":
		return strings.HasPrefix(s, "secret://") && identifier.MatchString(strings.TrimPrefix(s, "secret://"))
	}
	return false
}

// ValidateInputs checks overrides against the pinned version without echoing submitted values.
func (d Definition) ValidateInputs(input map[string]json.RawMessage) error {
	known := map[string]bool{}
	for _, p := range d.Parameters {
		known[p.Name] = true
		v, ok := input[p.Name]
		if ok && (!p.Override || !p.accepts(v)) {
			return fmt.Errorf("invalid override for %s", p.Name)
		}
		if !ok && p.Required && p.Default == nil {
			return fmt.Errorf("missing required parameter %s", p.Name)
		}
	}
	for name := range input {
		if !known[name] {
			return errors.New("unknown input parameter")
		}
	}
	return nil
}

type Summary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	Revision int    `json:"revision"`
	Version  int    `json:"version"`
}
type Pipeline struct {
	Summary
	Definition Definition `json:"definition"`
}
type Version struct {
	Number      int        `json:"number"`
	Checksum    string     `json:"checksum"`
	PublishedAt time.Time  `json:"publishedAt"`
	Definition  Definition `json:"definition"`
}
type Store interface {
	ListPipelines(context.Context, string) ([]Summary, error)
	GetPipeline(context.Context, string, string) (Pipeline, error)
	ChangePipeline(ctx context.Context, org, id, actor, action string, revision int, definition *Definition) (Pipeline, error)
	PipelineVersion(context.Context, string, string, int) (Version, error)
	PipelineVersions(context.Context, string, string) ([]Version, error)
}
