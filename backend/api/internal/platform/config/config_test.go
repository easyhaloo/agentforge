package config

import (
	"testing"
	"time"
)

func TestLoadFromValues(t *testing.T) {
	tests := []struct {
		name        string
		port        string
		databaseURL string
		appOrigin string
		wantPort    string
		wantErr     bool
	}{
		{name: "default port", databaseURL: "postgres://localhost/agentforge", appOrigin: "http://localhost:5173", wantPort: "8080"},
		{name: "configured port", port: "9090", databaseURL: "postgres://localhost/agentforge", appOrigin: "http://localhost:5173", wantPort: "9090"},
		{name: "invalid port", port: "70000", databaseURL: "postgres://localhost/agentforge", appOrigin: "http://localhost:5173", wantErr: true},
		{name: "invalid port text", port: "http", databaseURL: "postgres://localhost/agentforge", appOrigin: "http://localhost:5173", wantErr: true},
		{name: "missing database", port: "8080", wantErr: true},
		{name: "invalid database URL", port: "8080", databaseURL: "http://localhost/db", appOrigin: "http://localhost:5173", wantErr: true},
		{name: "missing app origin", port: "8080", databaseURL: "postgres://localhost/agentforge", wantErr: true},
		{name: "app origin path rejected", port: "8080", databaseURL: "postgres://localhost/agentforge", appOrigin: "https://app.example.com/path", wantErr: true},
		{name: "remote HTTP origin rejected", port: "8080", databaseURL: "postgres://localhost/agentforge", appOrigin: "http://app.example.com", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, err := load(test.port, test.databaseURL, test.appOrigin)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, test.wantErr)
			}
			if err == nil && config.Port != test.wantPort {
				t.Fatalf("port = %q, want %q", config.Port, test.wantPort)
			}
		})
	}
}

func TestLoadOIDCConfiguration(t *testing.T) {
	valid := func() (*OIDCConfig, time.Duration, error) {
		return loadOIDC("https://issuer.example.com", "agentforge-client", "secret", "https://api.example.com/auth/oidc/callback", "12h")
	}
	config, ttl, err := valid()
	if err != nil {
		t.Fatal(err)
	}
	if config == nil || config.ClientID != "agentforge-client" || ttl != 12*time.Hour {
		t.Fatalf("OIDC config=%#v ttl=%s", config, ttl)
	}

	if config, ttl, err := loadOIDC("", "", "", "", ""); err != nil || config != nil || ttl != 12*time.Hour {
		t.Fatalf("unconfigured OIDC result config=%#v ttl=%s err=%v", config, ttl, err)
	}
	tests := []struct {
		name string
		issuer, clientID, secret, redirect, ttl string
	}{
		{name: "partial configuration", issuer: "https://issuer.example.com"},
		{name: "insecure remote issuer", issuer: "http://issuer.example.com", clientID: "id", secret: "secret", redirect: "https://api.example.com/callback"},
		{name: "insecure remote callback", issuer: "https://issuer.example.com", clientID: "id", secret: "secret", redirect: "http://api.example.com/callback"},
		{name: "invalid TTL", issuer: "https://issuer.example.com", clientID: "id", secret: "secret", redirect: "https://api.example.com/callback", ttl: "999h"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, _, err := loadOIDC(test.issuer, test.clientID, test.secret, test.redirect, test.ttl); err == nil {
				t.Fatal("expected invalid OIDC configuration to fail")
			}
		})
	}

	if _, ttl, err := loadOIDC("http://localhost:5556", "id", "secret", "http://localhost:8080/auth/oidc/callback", "30m"); err != nil || ttl != 30*time.Minute {
		t.Fatalf("loopback development config ttl=%s err=%v", ttl, err)
	}
}

func TestLoadFromEnvValidatesSandboxEvaluatorConfiguration(t *testing.T) {
	t.Setenv("PORT","8080")
	t.Setenv("DATABASE_URL","postgres://agentforge:agentforge@localhost:5432/agentforge?sslmode=disable")
	t.Setenv("APP_ORIGIN","http://localhost:5173")
	t.Setenv("OIDC_ISSUER_URL","")
	t.Setenv("OIDC_CLIENT_ID","")
	t.Setenv("OIDC_CLIENT_SECRET","")
	t.Setenv("OIDC_REDIRECT_URL","")
	t.Setenv("SESSION_TTL","")
	t.Setenv("GIT_REPOSITORY_ROOT","")
	t.Setenv("EVIDENCE_ROOT","")
	t.Setenv("EVALUATION_DOCKER_IMAGE","ghcr.io/example/evaluator:latest")
	t.Setenv("EVALUATION_COMMAND","go test ./...")
	if _,err:=LoadFromEnv();err==nil {t.Fatal("mutable evaluator image tags must be rejected")}
	t.Setenv("EVALUATION_DOCKER_IMAGE","")
	if _,err:=LoadFromEnv();err==nil {t.Fatal("partial evaluator configuration must be rejected")}
	t.Setenv("EVALUATION_DOCKER_IMAGE","ghcr.io/example/evaluator@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	configuration,err:=LoadFromEnv()
	if err!=nil {t.Fatal(err)}
	if configuration.EvaluationDockerImage==""||configuration.EvaluationCommand!="go test ./..." {t.Fatalf("evaluation configuration=%#v",configuration)}
}
