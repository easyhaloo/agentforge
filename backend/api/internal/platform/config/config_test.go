package config

import (
	"testing"
)

func TestLoadFromValues(t *testing.T) {
	tests := []struct {
		name        string
		port        string
		databaseURL string
		wantPort    string
		wantErr     bool
	}{
		{name: "default port", databaseURL: "postgres://localhost/agentforge", wantPort: "8080"},
		{name: "configured port", port: "9090", databaseURL: "postgres://localhost/agentforge", wantPort: "9090"},
		{name: "invalid port", port: "70000", databaseURL: "postgres://localhost/agentforge", wantErr: true},
		{name: "invalid port text", port: "http", databaseURL: "postgres://localhost/agentforge", wantErr: true},
		{name: "missing database", port: "8080", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, err := load(test.port, test.databaseURL)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, test.wantErr)
			}
			if err == nil && config.Port != test.wantPort {
				t.Fatalf("port = %q, want %q", config.Port, test.wantPort)
			}
		})
	}
}
