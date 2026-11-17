package config

import (
	"testing"
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
