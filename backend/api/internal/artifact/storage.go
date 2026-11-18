// Package artifact stores bounded pipeline outputs and verifies them before release.
package artifact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const MaxBytes = 8 << 20

var ErrIntegrity = errors.New("pipeline object integrity check failed")
var ErrExpired = errors.New("pipeline object expired")
var ErrUnavailable = errors.New("pipeline object storage unavailable")

// Provenance comes from the fenced step and immutable run/version snapshot.
type Provenance struct {
	Organization   string `json:"organization"`
	Pipeline       string `json:"pipeline"`
	Version        int    `json:"version"`
	WorkflowSHA256 string `json:"workflowSha256"`
	Run            string `json:"run"`
	Step           string `json:"step"`
	Attempt        int    `json:"attempt"`
	Worker         string `json:"worker"`
	SourceSHA      string `json:"sourceSha,omitempty"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
}
type Record struct {
	ID         int64      `json:"id"`
	Provenance Provenance `json:"provenance"`
	SHA256     string     `json:"sha256"`
	Size       int64      `json:"size"`
	CreatedAt  time.Time  `json:"createdAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	PurgedAt   *time.Time `json:"purgedAt,omitempty"`
}
type Storage struct {
	client        *s3.Client
	Bucket        string
	RetentionDays int
}

var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func FromEnv(ctx context.Context) (*Storage, error) {
	bucket, endpoint, days := os.Getenv("PIPELINE_S3_BUCKET"), os.Getenv("PIPELINE_S3_ENDPOINT"), os.Getenv("PIPELINE_STORAGE_DAYS")
	if bucket == "" && endpoint == "" && days == "" {
		return nil, nil
	}
	if !bucketName.MatchString(bucket) {
		return nil, errors.New("configure a valid PIPELINE_S3_BUCKET")
	}
	retention := 30
	if days != "" {
		var err error
		retention, err = strconv.Atoi(days)
		if err != nil || retention < 1 || retention > 3650 {
			return nil, errors.New("PIPELINE_STORAGE_DAYS must be 1..3650")
		}
	}
	if endpoint != "" {
		u, e := url.Parse(endpoint)
		if e != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (net.ParseIP(u.Hostname()).IsLoopback() || u.Hostname() == "localhost"))) {
			return nil, errors.New("PIPELINE_S3_ENDPOINT requires an HTTPS origin (HTTP allowed on loopback)")
		}
	}
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	if cfg.Region == "" {
		return nil, errors.New("configure AWS_REGION for pipeline object storage")
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true
		}
	})
	return &Storage{client, bucket, retention}, nil
}
func identity(p Provenance) string {
	raw, _ := json.Marshal(p)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}
func Key(r Record) string { return "pipeline-objects/v1/" + identity(r.Provenance) + "/" + r.SHA256 }
func NewRecord(p Provenance, b []byte) Record {
	return Record{Provenance: p, SHA256: fmt.Sprintf("%x", sha256.Sum256(b)), Size: int64(len(b))}
}
func (s *Storage) Put(ctx context.Context, r Record, b []byte) (string, error) {
	if len(b) > MaxBytes || r.Size != int64(len(b)) || NewRecord(r.Provenance, b).SHA256 != r.SHA256 {
		return "", ErrIntegrity
	}
	digest, _ := hex.DecodeString(r.SHA256)
	out, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.Bucket, Key: aws.String(Key(r)), Body: bytes.NewReader(b), ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(digest)), Metadata: map[string]string{"provenance": identity(r.Provenance)}})
	if err != nil {
		return "", err
	}
	return aws.ToString(out.VersionId), nil
}
func versionID(version string) *string {
	if version == "" {
		return nil
	}
	return &version
}
func (s *Storage) Read(ctx context.Context, r Record, version string) ([]byte, error) {
	if r.Size < 0 || r.Size > MaxBytes {
		return nil, ErrIntegrity
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.Bucket, Key: aws.String(Key(r)), VersionId: versionID(version)})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	if out.Metadata["provenance"] != identity(r.Provenance) {
		return nil, ErrIntegrity
	}
	b, err := io.ReadAll(io.LimitReader(out.Body, r.Size+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) != r.Size || NewRecord(r.Provenance, b).SHA256 != r.SHA256 {
		return nil, ErrIntegrity
	}
	return b, nil
}
func (s *Storage) Delete(ctx context.Context, r Record, version string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.Bucket, Key: aws.String(Key(r)), VersionId: versionID(version)})
	return err
}
