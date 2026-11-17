package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	DatabaseURL string
}

func LoadFromEnv() (Config, error) {
	return load(os.Getenv("PORT"), os.Getenv("DATABASE_URL"))
}

func load(port, databaseURL string) (Config, error) {
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
	return Config{Port: port, DatabaseURL: databaseURL}, nil
}
