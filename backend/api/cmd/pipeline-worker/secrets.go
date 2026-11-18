package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
)

var safeComponent = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
var secretUnavailable = errors.New("step secret unavailable")

// The operator provisions a separate read-only secret-manager mount for each step scope.
func secretInput(base string, task execution.Task) (io.Reader, error) {
	if !filepath.IsAbs(base) || len(task.SecretRefs) > 16 {
		return nil, secretUnavailable
	}
	for _, id := range []string{task.OrganizationID, task.PipelineID, task.StepID} {
		if !safeComponent.MatchString(id) {
			return nil, secretUnavailable
		}
		base = filepath.Join(base, id)
		info, err := os.Lstat(base)
		if err != nil || !info.IsDir() {
			return nil, secretUnavailable
		}
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, secretUnavailable
	}
	defer root.Close()
	values := make(map[string]string, len(task.SecretRefs))
	for param, ref := range task.SecretRefs {
		name, ok := strings.CutPrefix(ref, "secret://")
		if !ok || !safeComponent.MatchString(name) || !safeComponent.MatchString(param) {
			return nil, secretUnavailable
		}
		info, err := root.Stat(name)
		if err != nil || !info.Mode().IsRegular() {
			return nil, secretUnavailable
		}
		f, err := root.Open(name)
		if err != nil {
			return nil, secretUnavailable
		}
		const limit = 16 << 10
		b, err := io.ReadAll(io.LimitReader(f, limit+1))
		f.Close()
		if err != nil || len(b) > limit || !utf8.Valid(b) {
			return nil, secretUnavailable
		}
		values[param] = string(b)
	}
	data, err := json.Marshal(values)
	if err != nil {
		return nil, secretUnavailable
	}
	return bytes.NewReader(data), nil
}
