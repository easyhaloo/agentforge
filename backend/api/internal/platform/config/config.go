package config

import (
	"errors"
	"net/url"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	DatabaseURL string
	AppOrigin   string
}

func LoadFromEnv() (Config, error) {
	return load(os.Getenv("PORT"), os.Getenv("DATABASE_URL"), os.Getenv("APP_ORIGIN"))
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
	return Config{Port: port, DatabaseURL: databaseURL, AppOrigin: appOrigin}, nil
}
