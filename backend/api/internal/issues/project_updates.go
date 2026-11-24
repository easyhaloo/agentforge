package issues

import "time"

type ProjectUpdate struct {
	ID         string    `json:"id"`
	Status     string    `json:"status"`
	Body       string    `json:"body"`
	AuthorName string    `json:"author_name"`
	CreatedAt  time.Time `json:"created_at"`
	StartDate  string    `json:"start_date,omitempty"`
	TargetDate string    `json:"target_date,omitempty"`
}

type ProjectUpdateInput struct {
	Status     string `json:"status"`
	Body       string `json:"body"`
	StartDate  string `json:"start_date"`
	TargetDate string `json:"target_date"`
}
