package issues

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

type ProjectFieldType string

const (
	ProjectFieldText         ProjectFieldType = "text"
	ProjectFieldNumber       ProjectFieldType = "number"
	ProjectFieldDate         ProjectFieldType = "date"
	ProjectFieldSingleSelect ProjectFieldType = "single_select"
	ProjectFieldIteration    ProjectFieldType = "iteration"
)

var (
	ErrProjectFieldNameInUse  = errors.New("project field name already in use")
	ErrProjectFieldOptionUsed = errors.New("project field option is in use")
	ErrProjectItemArchived    = errors.New("project item is archived")
)

type ProjectFieldOption struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
}

type ProjectField struct {
	ID      string               `json:"id"`
	Name    string               `json:"name"`
	Type    ProjectFieldType     `json:"type"`
	Options []ProjectFieldOption `json:"options"`
}

type ProjectFieldInput struct {
	ProjectVersion int64                `json:"project_version"`
	Name           string               `json:"name"`
	Type           ProjectFieldType     `json:"type"`
	Options        []ProjectFieldOption `json:"options"`
}

type ProjectFieldDefinitions struct {
	ProjectVersion int64          `json:"project_version"`
	Fields         []ProjectField `json:"fields"`
}

type ProjectFieldValueInput struct {
	ItemVersion int64           `json:"item_version"`
	Value       json.RawMessage `json:"value"`
}

type ProjectFieldValues struct {
	ItemVersion int64                      `json:"item_version"`
	Values      map[string]json.RawMessage `json:"values"`
}

func validProjectFieldText(value string, max int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
}

func validProjectFieldDate(value string) bool {
	date, err := time.Parse(time.DateOnly, value)
	return err == nil && date.Year() > 0 && date.Format(time.DateOnly) == value
}

// Normalize trims display names and validates the type-specific definition shape.
// The store validates the identity of any retained options against the saved field.
func (input *ProjectFieldInput) Normalize() error {
	input.Name = strings.TrimSpace(input.Name)
	if input.ProjectVersion < 1 || input.Name == "" || !validProjectFieldText(input.Name, 100) || strings.ContainsAny(input.Name, "\r\n\t") {
		return ErrProjectInvalid
	}
	if input.Options == nil {
		input.Options = []ProjectFieldOption{}
	}
	switch input.Type {
	case ProjectFieldText, ProjectFieldNumber, ProjectFieldDate:
		if len(input.Options) != 0 {
			return ErrProjectInvalid
		}
	case ProjectFieldSingleSelect, ProjectFieldIteration:
		if len(input.Options) < 1 || len(input.Options) > 50 {
			return ErrProjectInvalid
		}
	default:
		return ErrProjectInvalid
	}
	for i := range input.Options {
		option := &input.Options[i]
		option.Name = strings.TrimSpace(option.Name)
		if option.Name == "" || !validProjectFieldText(option.Name, 100) || strings.ContainsAny(option.Name, "\r\n\t") {
			return ErrProjectInvalid
		}
		for _, prior := range input.Options[:i] {
			if strings.EqualFold(prior.Name, option.Name) || (option.ID != "" && prior.ID == option.ID) {
				return ErrProjectInvalid
			}
		}
		if input.Type == ProjectFieldIteration {
			if !validProjectFieldDate(option.StartDate) || !validProjectFieldDate(option.EndDate) || option.StartDate > option.EndDate {
				return ErrProjectInvalid
			}
		} else if option.StartDate != "" || option.EndDate != "" {
			return ErrProjectInvalid
		}
	}
	return nil
}

func (field ProjectField) ValidateValue(value json.RawMessage) error {
	if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.UseNumber()
	var decoded any
	if !json.Valid(value) || decoder.Decode(&decoded) != nil {
		return ErrProjectInvalid
	}
	switch field.Type {
	case ProjectFieldNumber:
		if number, ok := decoded.(json.Number); ok {
			if _, err := number.Float64(); err == nil {
				return nil
			}
		}
	case ProjectFieldText, ProjectFieldDate, ProjectFieldSingleSelect, ProjectFieldIteration:
		text, ok := decoded.(string)
		if !ok {
			return ErrProjectInvalid
		}
		switch field.Type {
		case ProjectFieldText:
			if validProjectFieldText(text, 1000) {
				return nil
			}
		case ProjectFieldDate:
			if validProjectFieldDate(text) {
				return nil
			}
		default:
			for _, option := range field.Options {
				if option.ID == text {
					return nil
				}
			}
		}
	}
	return ErrProjectInvalid
}
