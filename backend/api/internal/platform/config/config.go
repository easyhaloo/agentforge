package config

import (
	"encoding/hex"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type OIDCConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

type Config struct {
	Port                  string
	DatabaseURL           string
	AppOrigin             string
	OIDC                  *OIDCConfig
	Google                *OIDCConfig
	GitHub                *OIDCConfig
	SessionTTL            time.Duration
	GitRepositoryRoot     string
	EvidenceRoot          string
	EvaluationDockerImage string
	EvaluationCommand     string
}

func LoadFromEnv() (Config, error) {
	configuration, err := load(os.Getenv("PORT"), os.Getenv("DATABASE_URL"), os.Getenv("APP_ORIGIN"))
	if err != nil {
		return Config{}, err
	}
	configuration.OIDC, err = loadOIDC(
		os.Getenv("OIDC_ISSUER_URL"),
		os.Getenv("OIDC_CLIENT_ID"),
		os.Getenv("OIDC_CLIENT_SECRET"),
		os.Getenv("OIDC_REDIRECT_URL"),
	)
	if err != nil {
		return Config{}, err
	}
	configuration.Google, err = loadNamedOAuth("GOOGLE", "https://accounts.google.com", configuration.AppOrigin+"/auth/google/callback")
	if err != nil {
		return Config{}, err
	}
	configuration.GitHub, err = loadNamedOAuth("GITHUB", "", configuration.AppOrigin+"/auth/github/callback")
	if err != nil {
		return Config{}, err
	}
	configuration.SessionTTL, err = loadSessionTTL(os.Getenv("SESSION_TTL"), configuration.OIDC != nil || configuration.Google != nil || configuration.GitHub != nil)
	if err != nil {
		return Config{}, err
	}
	configuration.GitRepositoryRoot = strings.TrimSpace(os.Getenv("GIT_REPOSITORY_ROOT"))
	configuration.EvidenceRoot = strings.TrimSpace(os.Getenv("EVIDENCE_ROOT"))
	configuration.EvaluationDockerImage = strings.TrimSpace(os.Getenv("EVALUATION_DOCKER_IMAGE"))
	configuration.EvaluationCommand = strings.TrimSpace(os.Getenv("EVALUATION_COMMAND"))
	if (configuration.EvaluationDockerImage == "") != (configuration.EvaluationCommand == "") {
		return Config{}, errors.New("EVALUATION_DOCKER_IMAGE and EVALUATION_COMMAND must be configured together")
	}
	if configuration.EvaluationDockerImage != "" {
		_, digest, ok := strings.Cut(configuration.EvaluationDockerImage, "@sha256:")
		if !ok || len(digest) != 64 {
			return Config{}, errors.New("EVALUATION_DOCKER_IMAGE must be pinned by a 64-character sha256 digest")
		}
		if _, decodeErr := hex.DecodeString(digest); decodeErr != nil {
			return Config{}, errors.New("EVALUATION_DOCKER_IMAGE contains an invalid sha256 digest")
		}
	}
	if configuration.GitRepositoryRoot != "" {
		configuration.GitRepositoryRoot, err = filepath.Abs(configuration.GitRepositoryRoot)
		if err != nil {
			return Config{}, errors.New("GIT_REPOSITORY_ROOT must be a valid local path")
		}
	}
	if configuration.EvidenceRoot != "" {
		configuration.EvidenceRoot, err = filepath.Abs(configuration.EvidenceRoot)
		if err != nil {
			return Config{}, errors.New("EVIDENCE_ROOT must be a valid local path")
		}
	}
	return configuration, nil
}

func load(port, databaseURL, appOrigin string) (Config, error) {
	port = strings.TrimSpace(port)
	if port == "" {
		port = "8080"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return Config{}, errors.New("PORT must be an integer between 1 and 65535")
	}

	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || (parsedURL.Scheme != "postgres" && parsedURL.Scheme != "postgresql") || parsedURL.Host == "" {
		return Config{}, errors.New("DATABASE_URL must be a valid PostgreSQL URL")
	}
	appOrigin = strings.TrimSpace(appOrigin)
	parsedOrigin, originErr := url.Parse(appOrigin)
	if originErr != nil || (parsedOrigin.Scheme != "http" && parsedOrigin.Scheme != "https") ||
		parsedOrigin.Host == "" || parsedOrigin.User != nil || parsedOrigin.Path != "" ||
		parsedOrigin.ForceQuery || parsedOrigin.RawQuery != "" || strings.Contains(appOrigin, "#") {
		return Config{}, errors.New("APP_ORIGIN must be an absolute HTTP(S) origin without a path")
	}
	if parsedOrigin.Scheme == "http" {
		ip := net.ParseIP(parsedOrigin.Hostname())
		if parsedOrigin.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return Config{}, errors.New("APP_ORIGIN must use HTTPS outside loopback development")
		}
	}
	return Config{Port: port, DatabaseURL: databaseURL, AppOrigin: appOrigin}, nil
}

func loadOIDC(issuerURL, clientID, clientSecret, redirectURL string) (*OIDCConfig, error) {
	values := []string{issuerURL, clientID, clientSecret, redirectURL}
	configured := 0
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			configured++
		}
	}
	if configured == 0 {
		return nil, nil
	}
	if configured != len(values) {
		return nil, errors.New("OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URL must be configured together")
	}

	issuerURL = strings.TrimSpace(issuerURL)
	issuer, err := url.Parse(issuerURL)
	if err != nil || (issuer.Scheme != "https" && issuer.Scheme != "http") ||
		issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
		return nil, errors.New("OIDC_ISSUER_URL must be an absolute issuer URL without query or fragment")
	}
	if issuer.Scheme == "http" {
		ip := net.ParseIP(issuer.Hostname())
		if issuer.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return nil, errors.New("OIDC_ISSUER_URL must use HTTPS outside loopback development")
		}
	}

	redirect, err := url.Parse(strings.TrimSpace(redirectURL))
	if err != nil || (redirect.Scheme != "https" && redirect.Scheme != "http") ||
		redirect.Host == "" || redirect.User != nil || redirect.RawQuery != "" || redirect.Fragment != "" {
		return nil, errors.New("OIDC_REDIRECT_URL must be an absolute HTTP(S) callback URL")
	}
	if redirect.Scheme == "http" {
		ip := net.ParseIP(redirect.Hostname())
		if redirect.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return nil, errors.New("OIDC_REDIRECT_URL must use HTTPS outside loopback development")
		}
	}

	return &OIDCConfig{
		IssuerURL: issuerURL, ClientID: strings.TrimSpace(clientID),
		ClientSecret: clientSecret, RedirectURL: redirect.String(),
	}, nil
}

func loadNamedOAuth(prefix, issuer, callback string) (*OIDCConfig, error) {
	idKey, secretKey := prefix+"_OAUTH_CLIENT_ID", prefix+"_OAUTH_CLIENT_SECRET"
	id, secret := strings.TrimSpace(os.Getenv(idKey)), strings.TrimSpace(os.Getenv(secretKey))
	if id == "" && secret == "" {
		return nil, nil
	}
	if id == "" || secret == "" {
		return nil, errors.New(idKey + " and " + secretKey + " must be configured together")
	}
	return &OIDCConfig{IssuerURL: issuer, ClientID: id, ClientSecret: secret, RedirectURL: callback}, nil
}

func loadSessionTTL(value string, providerConfigured bool) (time.Duration, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 12 * time.Hour, nil
	}
	if !providerConfigured {
		return 0, errors.New("SESSION_TTL requires a configured SSO provider")
	}
	ttl, err := time.ParseDuration(value)
	if err != nil || ttl < 5*time.Minute || ttl > 7*24*time.Hour {
		return 0, errors.New("SESSION_TTL must be between 5m and 168h")
	}
	return ttl, nil
}
