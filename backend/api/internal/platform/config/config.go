package config

import (
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
	Port        string
	DatabaseURL string
	AppOrigin   string
	OIDC        *OIDCConfig
	SessionTTL  time.Duration
	GitRepositoryRoot string
	EvidenceRoot string
	EvaluationDockerImage string
	EvaluationCommand string
}

func LoadFromEnv() (Config, error) {
	configuration, err := load(os.Getenv("PORT"), os.Getenv("DATABASE_URL"), os.Getenv("APP_ORIGIN"))
	if err != nil {
		return Config{}, err
	}
	oidcConfig, sessionTTL, err := loadOIDC(
		os.Getenv("OIDC_ISSUER_URL"),
		os.Getenv("OIDC_CLIENT_ID"),
		os.Getenv("OIDC_CLIENT_SECRET"),
		os.Getenv("OIDC_REDIRECT_URL"),
		os.Getenv("SESSION_TTL"),
	)
	if err != nil {
		return Config{}, err
	}
	configuration.OIDC = oidcConfig
	configuration.SessionTTL = sessionTTL
	configuration.GitRepositoryRoot = strings.TrimSpace(os.Getenv("GIT_REPOSITORY_ROOT"))
	configuration.EvidenceRoot = strings.TrimSpace(os.Getenv("EVIDENCE_ROOT"))
	configuration.EvaluationDockerImage = strings.TrimSpace(os.Getenv("EVALUATION_DOCKER_IMAGE"))
	configuration.EvaluationCommand = strings.TrimSpace(os.Getenv("EVALUATION_COMMAND"))
	if (configuration.EvaluationDockerImage == "") != (configuration.EvaluationCommand == "") { return Config{}, errors.New("EVALUATION_DOCKER_IMAGE and EVALUATION_COMMAND must be configured together") }
	if configuration.EvaluationDockerImage != "" && !strings.Contains(configuration.EvaluationDockerImage, "@sha256:") { return Config{}, errors.New("EVALUATION_DOCKER_IMAGE must be pinned by sha256 digest") }
	if configuration.GitRepositoryRoot != "" { configuration.GitRepositoryRoot, err = filepath.Abs(configuration.GitRepositoryRoot); if err != nil { return Config{}, errors.New("GIT_REPOSITORY_ROOT must be a valid local path") } }
	if configuration.EvidenceRoot != "" { configuration.EvidenceRoot, err = filepath.Abs(configuration.EvidenceRoot); if err != nil { return Config{}, errors.New("EVIDENCE_ROOT must be a valid local path") } }
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
		parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
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

func loadOIDC(issuerURL, clientID, clientSecret, redirectURL, sessionTTL string) (*OIDCConfig, time.Duration, error) {
	values := []string{issuerURL, clientID, clientSecret, redirectURL}
	configured := 0
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			configured++
		}
	}
	if configured == 0 {
		if strings.TrimSpace(sessionTTL) != "" {
			return nil, 0, errors.New("SESSION_TTL requires complete OIDC configuration")
		}
		return nil, 12 * time.Hour, nil
	}
	if configured != len(values) {
		return nil, 0, errors.New("OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URL must be configured together")
	}

	issuerURL = strings.TrimSpace(issuerURL)
	issuer, err := url.Parse(issuerURL)
	if err != nil || (issuer.Scheme != "https" && issuer.Scheme != "http") ||
		issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
		return nil, 0, errors.New("OIDC_ISSUER_URL must be an absolute issuer URL without query or fragment")
	}
	if issuer.Scheme == "http" {
		ip := net.ParseIP(issuer.Hostname())
		if issuer.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return nil, 0, errors.New("OIDC_ISSUER_URL must use HTTPS outside loopback development")
		}
	}

	redirect, err := url.Parse(strings.TrimSpace(redirectURL))
	if err != nil || (redirect.Scheme != "https" && redirect.Scheme != "http") ||
		redirect.Host == "" || redirect.User != nil || redirect.RawQuery != "" || redirect.Fragment != "" {
		return nil, 0, errors.New("OIDC_REDIRECT_URL must be an absolute HTTP(S) callback URL")
	}
	if redirect.Scheme == "http" {
		ip := net.ParseIP(redirect.Hostname())
		if redirect.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return nil, 0, errors.New("OIDC_REDIRECT_URL must use HTTPS outside loopback development")
		}
	}

	ttl := 12 * time.Hour
	if strings.TrimSpace(sessionTTL) != "" {
		ttl, err = time.ParseDuration(strings.TrimSpace(sessionTTL))
		if err != nil || ttl < 5*time.Minute || ttl > 7*24*time.Hour {
			return nil, 0, errors.New("SESSION_TTL must be between 5m and 168h")
		}
	}
	return &OIDCConfig{
		IssuerURL: issuerURL, ClientID: strings.TrimSpace(clientID),
		ClientSecret: clientSecret, RedirectURL: redirect.String(),
	}, ttl, nil
}
