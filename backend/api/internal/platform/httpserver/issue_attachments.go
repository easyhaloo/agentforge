package httpserver

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

var issueAttachmentID = regexp.MustCompile(`^[a-f0-9]{32}$`)

const issueAttachmentVideoQuery = "?media=video"

var attachmentImages = map[string]string{
	".png": "image/png", ".gif": "image/gif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
}

var attachmentVideos = map[string]string{
	".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
}

func matchesAttachmentMedia(content []byte, contentType string) bool {
	switch contentType {
	case "image/svg+xml":
		decoder := xml.NewDecoder(bytes.NewReader(content))
		for {
			token, err := decoder.Token()
			if err != nil {
				return false
			}
			if element, ok := token.(xml.StartElement); ok {
				return element.Name.Local == "svg" && element.Name.Space == "http://www.w3.org/2000/svg"
			}
		}
	case "video/quicktime":
		// ponytail: match modern QuickTime files with a brand header. Probe legacy codecs only if needed.
		return len(content) >= 16 && bytes.Equal(content[4:12], []byte("ftypqt  "))
	default:
		return contentType == http.DetectContentType(content)
	}
}

func issueAttachmentPath(organizationID, id string) string {
	return "/api/v1/organizations/" + url.PathEscape(organizationID) + "/issue-attachments/" + id
}

func validIssueAttachmentIDs(organizationID, body string, ids []string) bool {
	if len(ids) > 20 {
		return false
	}
	for _, id := range ids {
		attachmentURL := issueAttachmentPath(organizationID, id)
		if !issueAttachmentID.MatchString(id) || (!strings.Contains(body, "]("+attachmentURL+")") &&
			!strings.Contains(body, "]("+attachmentURL+issueAttachmentVideoQuery+")")) {
			return false
		}
	}
	return true
}

func (d DeliveryDependencies) stageIssueAttachment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, true)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
		return
	}

	filename := strings.TrimSpace(r.URL.Query().Get("filename"))
	if filename == "" || len(filename) > 255 || !utf8.ValidString(filename) ||
		strings.ContainsAny(filename, `/\`) || strings.ContainsFunc(filename, unicode.IsControl) {
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid filename", "Choose a file with a valid name")
		return
	}
	limit := int64(25 << 20)
	extension := strings.ToLower(path.Ext(filename))
	imageType := attachmentImages[extension]
	videoType := attachmentVideos[extension]
	switch extension {
	case ".png", ".gif", ".jpg", ".jpeg", ".svg", ".mp4", ".mov", ".webm":
		limit = 10 << 20
	case ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".xlsm", ".odt", ".fodt", ".ods", ".fods", ".odp", ".fodp", ".odg", ".fodg", ".odf", ".rtf", ".doc",
		".txt", ".md", ".copilotmd", ".csv", ".tsv", ".log", ".json", ".jsonc", ".c", ".cs", ".cpp", ".css", ".drawio", ".dmp", ".html", ".htm",
		".java", ".js", ".ipynb", ".patch", ".php", ".cpuprofile", ".pdb", ".py", ".sh", ".sql", ".ts", ".tsx", ".xml", ".yml", ".yaml",
		".zip", ".gz", ".tgz", ".debug", ".msg", ".eml", ".bmp", ".tif", ".tiff", ".mp3", ".wav":
	default:
		writeProblem(w, http.StatusUnsupportedMediaType, "Unsupported attachment type", "Choose a supported file format")
		return
	}
	if r.ContentLength > limit {
		writeProblem(w, http.StatusRequestEntityTooLarge, "Attachment too large", "The file exceeds the attachment size limit")
		return
	}
	repository := r.URL.Query().Get("repository")
	if _, ok := d.resolveRegisteredRepository(w, r, principal, repository); !ok {
		return
	}
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge):
		writeProblem(w, http.StatusRequestEntityTooLarge, "Attachment too large", "The file exceeds the attachment size limit")
		return
	case err != nil || len(content) == 0:
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid attachment", "Choose a readable, non-empty file")
		return
	case videoType != "" && !matchesAttachmentMedia(content, videoType):
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid video", "The video content must match its file format")
		return
	case imageType != "" && !matchesAttachmentMedia(content, imageType):
		writeProblem(w, http.StatusUnprocessableEntity, "Invalid image", "The image content must match its file format")
		return
	}
	contentType := "application/octet-stream"
	if imageType != "" {
		contentType = imageType
	} else if videoType != "" {
		contentType = videoType
	}
	id, err := newID()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to upload attachment", "An identifier could not be generated")
		return
	}
	file := issues.AttachmentDraft{ID: id, Repository: repository, UploaderID: principal.UserID, Filename: filename, ContentType: contentType, Content: content}
	if err := d.IssueRepo.StageAttachment(r.Context(), principal.OrganizationID, file); errors.Is(err, issues.ErrDetailNotFound) {
		issueDetailError(w, err)
		return
	} else if errors.Is(err, issues.ErrAttachmentQuota) {
		writeProblem(w, http.StatusTooManyRequests, "Attachment draft quota reached", "The total size of unpublished attachments exceeds the limit")
		return
	} else if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to upload attachment", "The file could not be stored")
		return
	}
	attachmentURL := issueAttachmentPath(principal.OrganizationID, id)
	if videoType != "" {
		attachmentURL += issueAttachmentVideoQuery
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "url": attachmentURL, "name": filename, "image": imageType != "",
	})
}

func (d DeliveryDependencies) getIssueAttachment(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if d.IssueRepo == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Issue tracking unavailable", "The issue repository is not configured")
		return
	}
	id := r.PathValue("attachmentID")
	if !issueAttachmentID.MatchString(id) {
		writeProblem(w, http.StatusNotFound, "Attachment not found", "The file is unavailable")
		return
	}
	file, err := d.IssueRepo.GetAttachment(r.Context(), principal.OrganizationID, principal.UserID, id)
	if errors.Is(err, issues.ErrAttachmentNotFound) {
		writeProblem(w, http.StatusNotFound, "Attachment not found", "The file is unavailable")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Unable to read attachment", "The file could not be read")
		return
	}
	if _, ok := d.resolveRegisteredRepository(w, r, principal, file.Repository); !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", file.ContentType)
	if file.ContentType == "image/svg+xml" {
		// Also sandbox direct navigation to prevent uploaded SVG from accessing the app origin.
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	}
	disposition := "attachment"
	if file.ContentType != "application/octet-stream" && r.URL.Query().Get("download") == "" {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": file.Filename}))
	http.ServeContent(w, r, file.Filename, time.Time{}, bytes.NewReader(file.Content))
}
