package delivery

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// VisitPushedCommits walks the commits made reachable by an accepted branch update.
// A new branch has no previous tip, so exclude its captured default-branch base when available.
func (p *LocalGitProvider) VisitPushedCommits(ctx context.Context, org, repository, oldSHA, newSHA string, visit func(sha, subject, message string) error) error {
	if !validGitObjectID(newSHA) || (oldSHA != "" && !validGitObjectID(oldSHA)) {
		return ErrRepositoryInvalid
	}
	path, err := p.repositoryPath(ctx, org, repository)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	args := []string{"-C", path, "log", "-z", "--no-show-signature", "--format=%H%x00%s%x00%B", newSHA}
	if strings.Trim(oldSHA, "0") != "" {
		args = append(args, "^"+oldSHA)
	}
	cmd := exec.CommandContext(ctx, "git", append(args, "--")...)
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_NO_REPLACE_OBJECTS=1"}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() {
		cancel()
		_ = cmd.Wait()
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 64<<20)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if end := bytes.IndexByte(data, 0); end >= 0 {
			return end + 1, data[:end], nil
		}
		if atEOF && len(data) > 0 {
			return 0, nil, errors.New("unterminated Git commit field")
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		sha := scanner.Text()
		if !validGitObjectID(sha) || !scanner.Scan() {
			return ErrRepositoryInvalid
		}
		subject := scanner.Bytes()
		if len(subject) > 1024 {
			subject = subject[:1024]
		}
		label := strings.ToValidUTF8(string(subject), "�")
		if !scanner.Scan() {
			return ErrRepositoryInvalid
		}
		if err := visit(sha, label, scanner.Text()); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read pushed commits: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("list pushed commits: %w", err)
	}
	return nil
}
