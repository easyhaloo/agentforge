package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const githubIssuer = "https://github.com"
const githubAPI = "https://api.github.com"

func NewGitHubAuthenticator(configuration OIDCConfig, repository OIDCRepository) (*OIDCAuthenticator, error) {
	if configuration.ProviderID != "" && configuration.ProviderID != "github" {
		return nil, errors.New("invalid GitHub provider configuration")
	}
	configuration.ProviderID = "github"
	a, err := newAuthenticator(configuration, repository)
	if err != nil {
		return nil, err
	}
	a.oauth.Endpoint = github.Endpoint
	a.oauth.Endpoint.AuthStyle = oauth2.AuthStyleInParams
	a.oauth.Scopes = []string{"user:email"}
	return a, nil
}

func githubProfile(ctx context.Context, token *oauth2.Token) (externalProfile, error) {
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))
	var user struct {
		ID    uint64 `json:"id"`
		Name  string `json:"name"`
		Login string `json:"login"`
	}
	if err := githubGet(ctx, client, "/user", &user); err != nil {
		return externalProfile{}, err
	}
	if user.ID == 0 {
		return externalProfile{}, errors.New("missing GitHub user ID")
	}
	profile := externalProfile{issuer: githubIssuer, subject: strconv.FormatUint(user.ID, 10), name: strings.TrimSpace(user.Name)}
	if profile.name == "" {
		profile.name = strings.TrimSpace(user.Login)
	}
	const pageSize = 100
	for page := 1; ; page++ {
		var emails []struct {
			Email    string `json:"email"`
			Primary  bool   `json:"primary"`
			Verified bool   `json:"verified"`
		}
		if err := githubGet(ctx, client, fmt.Sprintf("/user/emails?per_page=%d&page=%d", pageSize, page), &emails); err != nil {
			return externalProfile{}, err
		}
		for _, email := range emails {
			if email.Primary {
				if email.Verified {
					profile.email = strings.TrimSpace(email.Email)
				}
				return profile, nil
			}
		}
		if len(emails) < pageSize {
			return profile, nil
		}
	}
}

func githubGet(ctx context.Context, client *http.Client, endpoint string, destination any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPI+endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub profile request failed with HTTP %d", resp.StatusCode)
	}
	const maxProfileSize = 1 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProfileSize+1))
	if err != nil {
		return err
	}
	if len(body) > maxProfileSize {
		return errors.New("GitHub profile response exceeds size limit")
	}
	return json.Unmarshal(body, destination)
}
