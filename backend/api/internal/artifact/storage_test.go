package artifact

import (
	"context"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestStorageConfiguration(t *testing.T) {
	t.Setenv("PIPELINE_S3_BUCKET", "")
	t.Setenv("PIPELINE_S3_ENDPOINT", "")
	t.Setenv("PIPELINE_STORAGE_DAYS", "")
	ctx := t.Context()
	if store, err := FromEnv(ctx); err != nil || store != nil {
		t.Fatal("disabled", err)
	}
	t.Setenv("PIPELINE_STORAGE_DAYS", "1")
	if _, err := FromEnv(ctx); err == nil {
		t.Fatal("missing bucket")
	}
	t.Setenv("PIPELINE_S3_BUCKET", "valid-bucket")
	t.Setenv("PIPELINE_STORAGE_DAYS", "0")
	if _, err := FromEnv(ctx); err == nil {
		t.Fatal("zero retention")
	}
	t.Setenv("PIPELINE_STORAGE_DAYS", "30")
	for _, ep := range []string{"http://provider.example", "https://provider.example/path", "https://user@provider.example"} {
		t.Setenv("PIPELINE_S3_ENDPOINT", ep)
		if _, err := FromEnv(ctx); err == nil {
			t.Fatal("invalid endpoint accepted", ep)
		}
	}
}

// Runs against a private, disposable MinIO process. No external account needed.
func TestMinIOPipelineObjects(t *testing.T) {
	bin := os.Getenv("TEST_MINIO_BINARY")
	if bin == "" {
		t.Skip("set TEST_MINIO_BINARY to a MinIO server executable")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	endpoint := "http://" + addr
	t.Setenv("PIPELINE_S3_BUCKET", "pipeline-storage-test")
	t.Setenv("PIPELINE_S3_ENDPOINT", endpoint)
	t.Setenv("PIPELINE_STORAGE_DAYS", "30")
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "test-operator")
	t.Setenv("AWS_SECRET_ACCESS_KEY", rand.Text())
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("MINIO_ROOT_USER", os.Getenv("AWS_ACCESS_KEY_ID"))
	t.Setenv("MINIO_ROOT_PASSWORD", os.Getenv("AWS_SECRET_ACCESS_KEY"))
	t.Setenv("MINIO_BROWSER", "off")
	cmd := exec.CommandContext(ctx, bin, "server", "--address", addr, "--console-address", "127.0.0.1:0", t.TempDir())
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); cmd.Wait() }()
	client := &http.Client{Timeout: time.Second}
	for {
		resp, err := client.Get(endpoint + "/minio/health/ready")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("MinIO did not start")
		case <-time.After(50 * time.Millisecond):
		}
	}
	store, err := FromEnv(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &store.Bucket}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.client.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{Bucket: &store.Bucket, VersioningConfiguration: &types.VersioningConfiguration{Status: types.BucketVersioningStatusEnabled}}); err != nil {
		t.Fatal(err)
	}
	p := Provenance{Run: "test-run", Step: "compile", Organization: "test-org", Worker: "test-runner", Attempt: 1, Name: "result.json", Kind: "artifact"}
	data := []byte(`{"outcome":"succeeded"}`)
	record := NewRecord(p, data)
	version, err := store.Put(ctx, record, data)
	if err != nil || version == "" {
		t.Fatalf("versioned upload: %v", err)
	}
	b, err := store.Read(ctx, record, version)
	if err != nil || string(b) != string(data) {
		t.Fatal("read", err)
	}
	if _, err = store.Put(ctx, record, []byte("bad")); !errors.Is(err, ErrIntegrity) {
		t.Fatal("accepted invalid checksum", err)
	}
	if err = store.Delete(ctx, record, version); err != nil {
		t.Fatal(err)
	}
	if err = store.Delete(ctx, record, version); err != nil {
		t.Fatalf("delete replay: %v", err)
	}
	versions, err := store.client.ListObjectVersions(ctx, &s3.ListObjectVersionsInput{Bucket: &store.Bucket})
	if err != nil || len(versions.Versions) != 0 || len(versions.DeleteMarkers) != 0 {
		t.Fatal("version retained", err)
	}
}
