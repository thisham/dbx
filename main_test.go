package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEmbeddedAssets(t *testing.T) {
	for _, path := range []string{"/", "/app.js", "/app.css"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			if w.Code != http.StatusOK || w.Body.Len() == 0 {
				t.Fatalf("asset %s: status=%d bytes=%d", path, w.Code, w.Body.Len())
			}
			if w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing content type protection")
			}
			if path == "/" && !strings.Contains(w.Body.String(), "Schema source code") {
				t.Fatal("editor missing from index")
			}
		})
	}
}
func TestUnknownAsset(t *testing.T) {
	w := httptest.NewRecorder()
	handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("got status %d", w.Code)
	}
}
