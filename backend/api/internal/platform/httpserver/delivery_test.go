package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type memoryRepository struct { items map[delivery.ID]delivery.StoredChangeset }

func newMemoryRepository() *memoryRepository { return &memoryRepository{items: make(map[delivery.ID]delivery.StoredChangeset)} }
func (m *memoryRepository) Create(_ context.Context, c *delivery.Changeset) (delivery.StoredChangeset, error) {
	if _, ok := m.items[c.ID]; ok { return delivery.StoredChangeset{}, errors.New("duplicate") }
	now := time.Now().UTC()
	item := delivery.StoredChangeset{Changeset:c, Version:1, CreatedAt:now, UpdatedAt:now}
	m.items[c.ID] = item
	return item,nil
}
func (m *memoryRepository) Update(_ context.Context, c *delivery.Changeset, version int64) (delivery.StoredChangeset,error) {
	item,ok:=m.items[c.ID]; if !ok { return delivery.StoredChangeset{},delivery.ErrNotFound }
	if item.Version!=version { return delivery.StoredChangeset{},errors.New("version conflict") }
	item.Changeset=c; item.Version++; item.UpdatedAt=time.Now().UTC(); m.items[c.ID]=item; return item,nil
}
func (m *memoryRepository) Get(_ context.Context,id delivery.ID)(delivery.StoredChangeset,error){
	item,ok:=m.items[id]; if !ok{return delivery.StoredChangeset{},delivery.ErrNotFound}; return item,nil
}
func (m *memoryRepository) List(_ context.Context,limit,offset int)([]delivery.StoredChangeset,error){
	if limit<1||limit>100||offset<0{return nil,delivery.ErrInvalidInput}
	items:=make([]delivery.StoredChangeset,0,len(m.items)); for _,item:=range m.items{items=append(items,item)}
	if offset>=len(items){return []delivery.StoredChangeset{},nil}; end:=offset+limit;if end>len(items){end=len(items)};return items[offset:end],nil
}
type fixedIdentity struct{}
func (fixedIdentity) ResolveActor(*http.Request)(string,error) { return "test-user",nil }

func TestDeliveryAPIRequiresTrustedIdentityForWrites(t *testing.T) {
	handler:=NewHandlerWithDependencies(DeliveryDependencies{Repository:newMemoryRepository()})
	request:=httptest.NewRequest(http.MethodPost,"/api/v1/changesets",bytes.NewBufferString(`{"repository":"org/repo","title":"Change","actor":"forged"}`))
	response:=httptest.NewRecorder();handler.ServeHTTP(response,request)
	if response.Code!=http.StatusServiceUnavailable { t.Fatalf("status=%d, want %d",response.Code,http.StatusServiceUnavailable) }
}

func TestDeliveryAPIUsesTrustedIdentityForChangesetMetadata(t *testing.T) {
	repository := newMemoryRepository()
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{}})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/changesets", bytes.NewBufferString(`{"repository":"org/repo","title":"Add capability"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated { t.Fatalf("create status=%d body=%s", response.Code, response.Body.String()) }
	var stored storedChangesetResponse
	if err := json.Unmarshal(response.Body.Bytes(), &stored); err != nil { t.Fatal(err) }
	if stored.Changeset.CreatedBy != "test-user" { t.Fatalf("created_by=%q, want trusted identity", stored.Changeset.CreatedBy) }

	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/changesets", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK { t.Fatalf("list status=%d body=%s", listResponse.Code, listResponse.Body.String()) }
}

func TestDeliveryAPIRejectsUnconfiguredLifecycleAdapters(t *testing.T) {
	repository := newMemoryRepository()
	now := time.Now().UTC()
	changeset, err := delivery.NewChangeset("cs-existing", "org/repo", "Change", "author", now)
	if err != nil { t.Fatal(err) }
	if _, err := repository.Create(context.Background(), changeset); err != nil { t.Fatal(err) }
	handler := NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: fixedIdentity{}})
	requests := []struct{ path, body string }{
		{"/api/v1/changesets/cs-existing/revisions", `{"ref":"commit-1"}`},
		{"/api/v1/changesets/cs-existing/evaluations", `{"revision_id":"rev-1","status":"passed","summary":"client cannot assert success"}`},
		{"/api/v1/changesets/cs-existing/evidence", `{"revision_id":"rev-1","evaluation_id":"eval-1","kind":"ci","uri":"https://example.test"}`},
		{"/api/v1/changesets/cs-existing/reviews", `{"revision_id":"rev-1"}`},
		{"/api/v1/changesets/cs-existing/reviews/rev-1/decision", `{"approved":true}`},
	}
	for _, item := range requests {
		request := httptest.NewRequest(http.MethodPost, item.path, bytes.NewBufferString(item.body))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotImplemented { t.Fatalf("%s status=%d, want %d: %s", item.path, response.Code, http.StatusNotImplemented, response.Body.String()) }
	}
	persisted, err := repository.Get(context.Background(), "cs-existing")
	if err != nil { t.Fatal(err) }
	if len(persisted.Changeset.Revisions) != 0 || len(persisted.Changeset.Evaluations) != 0 || len(persisted.Changeset.Evidence) != 0 || len(persisted.Changeset.Reviews) != 0 {
		t.Fatal("unconfigured adapters must not mutate delivery state")
	}
}

func decodeStored(t *testing.T,response *httptest.ResponseRecorder) storedChangesetResponse {
	t.Helper();var stored storedChangesetResponse;if err:=json.Unmarshal(response.Body.Bytes(),&stored);err!=nil{t.Fatal(err)};return stored
}
func mustJSON(t *testing.T,value any) string {
	t.Helper();encoded,err:=json.Marshal(value);if err!=nil{t.Fatal(err)};return string(encoded)
}
