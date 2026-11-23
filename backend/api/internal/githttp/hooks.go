package githttp

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

const MaxPushRefs = 128

// PushPolicy is loaded while holding the repository row lock for a Git receive.
type PushPolicy struct {
	DefaultBranch            string
	RefLimit                 int
	ProtectedRefs            []string
	RefRules                 []RefRule
	WebCommitSignoffRequired bool
}

func (policy PushPolicy) AllowsBranchDeletion(branch string) bool {
	if branch == "" || branch == policy.DefaultBranch || protectedRef(policy.ProtectedRefs, "refs/heads/"+branch) {
		return false
	}
	for _, rule := range policy.RefRules {
		if rule.RestrictDeletion && rule.matches("branch", branch, policy.DefaultBranch) {
			return false
		}
	}
	return true
}

func protectedRef(patterns []string, ref string) bool {
	for _, pattern := range patterns {
		if matched, _ := path.Match(pattern, ref); matched && strings.Count(pattern, "/") == strings.Count(ref, "/") {
			return true
		}
	}
	return false
}

func ValidProtectedRefs(patterns []string) bool {
	if len(patterns) > 20 {
		return false
	}
	seen := make(map[string]bool, len(patterns))
	for _, pattern := range patterns {
		prefix, name, ok := strings.Cut(strings.TrimPrefix(pattern, "refs/"), "/")
		if !strings.HasPrefix(pattern, "refs/") || !ok || (prefix != "heads" && prefix != "tags") ||
			name == "" || len(name) > 128 || strings.ContainsAny(name, "\\~^:") || seen[pattern] {
			return false
		}
		for _, ch := range name {
			if ch <= ' ' || ch == 127 {
				return false
			}
		}
		for segment := range strings.SplitSeq(name, "/") {
			if _, err := path.Match(segment, ""); err != nil || segment == "" || strings.HasPrefix(segment, ".") || strings.HasSuffix(segment, ".lock") {
				return false
			}
		}
		seen[pattern] = true
	}
	return true
}

const helperCommand = "agentforge-git-http-backend"

// PushEvent is one accepted Git receive. Consumers can deduplicate by ID.
// Zero SHAs mean ref creation/deletion. Tag SHAs may identify tag objects.
type PushEvent struct {
	ID           string      `json:"id"`
	Organization string      `json:"organization_id"`
	Repository   string      `json:"repository"`
	Actor        string      `json:"actor_id"`
	Base         string      `json:"base_sha,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
	Updates      []RefUpdate `json:"updates"`
}

type RefUpdate struct {
	Ref string `json:"ref"`
	Old string `json:"old_sha"`
	New string `json:"new_sha"`
}

// RunHelper dispatches only the private CGI launcher and hooks used by Transport.
// It runs before the server loads configuration or opens any connections.
func RunHelper(args []string) (handled bool, status int) {
	name := filepath.Base(args[0])
	if len(args) == 3 && args[1] == helperCommand {
		backend := args[2]
		if !filepath.IsAbs(backend) || filepath.Base(backend) != "git-http-backend" {
			return true, 1
		}
		limits := map[int]uint64{
			syscall.RLIMIT_CPU: 60, syscall.RLIMIT_FSIZE: 512 << 20, syscall.RLIMIT_NOFILE: 256,
		}
		if runtime.GOOS == "linux" {
			limits[syscall.RLIMIT_AS] = 2 << 30
		}
		for resource, limit := range limits {
			if err := syscall.Setrlimit(resource, &syscall.Rlimit{Cur: limit, Max: limit}); err != nil {
				return true, 1
			}
		}
		_ = syscall.Exec(backend, []string{backend}, os.Environ())
		return true, 1
	}
	if name != "pre-receive" && name != "post-receive" {
		return false, 0
	}
	if err := receiveHook(name, os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, "AgentForge:", err)
		return true, 1
	}
	return true, 0
}

func prepareHooks(hooks, journal, helper string) error {
	for _, dir := range []string{journal, intentDirectory(journal)} {
		if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		if stat, err := os.Lstat(dir); err != nil || !stat.IsDir() {
			return errors.New("invalid push journal directory")
		}
		if err := syncDirectory(filepath.Dir(dir)); err != nil {
			return err
		}
	}
	for _, name := range []string{"pre-receive", "post-receive"} {
		if err := os.Symlink(helper, filepath.Join(hooks, name)); err != nil {
			return err
		}
	}
	return nil
}

func receiveHook(name string, input io.Reader) error {
	journal := os.Getenv("AF_GIT_JOURNAL")
	if !filepath.IsAbs(journal) || filepath.Base(journal) != ".agentforge-push-events" {
		return errors.New("push journal unavailable")
	}
	var updates []RefUpdate
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 1024), 4096)
	for scanner.Scan() {
		parts := strings.Split(scanner.Text(), " ")
		if len(updates) >= MaxPushRefs || len(parts) != 3 || !validObjectID(parts[0]) || !validObjectID(parts[1]) || len(parts[0]) != len(parts[1]) {
			return errors.New("invalid ref updates or too many refs in one push")
		}
		updates = append(updates, RefUpdate{Ref: parts[2], Old: parts[0], New: parts[1]})
	}
	if scanner.Err() != nil || len(updates) == 0 {
		return errors.New("invalid ref updates")
	}
	event := PushEvent{Organization: os.Getenv("AF_GIT_ORG"), Repository: os.Getenv("AF_GIT_REPO"),
		Actor: os.Getenv("AF_GIT_ACTOR"), Base: os.Getenv("AF_GIT_BASE"), CreatedAt: time.Now().UTC(), Updates: updates}
	intent := filepath.Join(intentDirectory(journal), os.Getenv("AF_GIT_INTENT"))
	id, err := uuid.Parse(filepath.Base(intent))
	if err != nil {
		return errors.New("push intent unavailable")
	}
	event.ID = id.String()
	if name == "pre-receive" {
		limit, err := strconv.Atoi(os.Getenv("AF_GIT_PUSH_REF_LIMIT"))
		if err != nil || (limit != 0 && (limit < 2 || limit > MaxPushRefs)) {
			return errors.New("push ref limit unavailable")
		}
		if limit > 0 && len(updates) > limit {
			return fmt.Errorf("push exceeds the repository limit of %d branch and tag updates", limit)
		}
		head, err := os.ReadFile("HEAD") // Git invokes push hooks in $GIT_DIR.
		if err != nil || os.Getenv("AF_GIT_DEFAULT") == "" {
			return errors.New("default branch protection unavailable")
		}
		headRef, _ := strings.CutPrefix(strings.TrimSpace(string(head)), "ref: ")
		defaultRef := "refs/heads/" + os.Getenv("AF_GIT_DEFAULT")
		var protectedRefs []string
		if err := json.Unmarshal([]byte(os.Getenv("AF_GIT_PROTECTED_REFS")), &protectedRefs); err != nil || !ValidProtectedRefs(protectedRefs) {
			return errors.New("ref protection unavailable")
		}
		var rules []RefRule
		if err := json.Unmarshal([]byte(os.Getenv("AF_GIT_REF_RULES")), &rules); err != nil || !ValidRefRules(rules) {
			return errors.New("repository rulesets unavailable")
		}
		for _, update := range updates {
			if !strings.HasPrefix(update.Ref, "refs/heads/") && !strings.HasPrefix(update.Ref, "refs/tags/") {
				return errors.New("only branch and tag updates are allowed")
			}
			if update.Ref == defaultRef || update.Ref == headRef {
				return errors.New("direct updates to the default branch are prohibited")
			}
			if protectedRef(protectedRefs, update.Ref) {
				return fmt.Errorf("direct pushes to %s are prohibited by repository settings", update.Ref)
			}
			if err := checkRefRules(rules, update, os.Getenv("AF_GIT_DEFAULT")); err != nil {
				return err
			}
		}
		if err := writePushEvent(intent, event); err != nil {
			return errors.New("could not persist push intent")
		}
		return nil
	}

	if err := finishPush(journal, intent, event); err != nil {
		return errors.New("refs updated; push event is pending recovery")
	}
	return nil
}

func validObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func writePushEvent(path string, event PushEvent) error {
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := json.NewEncoder(file).Encode(event); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	return syncDirectory(dir)
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
