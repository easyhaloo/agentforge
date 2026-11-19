package httpserver

import "testing"

func TestRepositoryImageContentTypeAllowsOnlyPassiveRasterFormats(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"png", []byte("\x89PNG\r\n\x1a\nrest"), "image/png"},
		{"jpeg", []byte("\xff\xd8\xff\xe0rest"), "image/jpeg"},
		{"gif87", []byte("GIF87arest"), "image/gif"},
		{"gif89", []byte("GIF89arest"), "image/gif"},
		{"webp", []byte("RIFFxxxxWEBPrest"), "image/webp"},
		{"svg", []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), ""},
		{"html", []byte("<script>alert(1)</script>"), ""},
		{"unknown", []byte{0, 1, 2, 3}, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := repositoryImageContentType(test.data); got != test.want {
				t.Fatalf("content type = %q, want %q", got, test.want)
			}
		})
	}
}
