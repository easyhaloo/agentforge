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
func (fixedIdentity) ResolveActor(*http.Request)(string,error){return "test-user",nil}

func TestDeliveryAPIRequiresTrustedIdentityForWrites(t *testing.T) {
	handler:=NewHandlerWithDependencies(DeliveryDependencies{Repository:newMemoryRepository()})
	request:=httptest.NewRequest(http.MethodPost,"/api/v1/changesets",bytes.NewBufferString(`{"repository":"org/repo","title":"Change","actor":"forged"}`))
	response:=httptest.NewRecorder();handler.ServeHTTP(response,request)
	if response.Code!=http.StatusServiceUnavailable { t.Fatalf("status=%d, want %d",response.Code,http.StatusServiceUnavailable) }
}

func TestDeliveryLifecyclePersistsRevisionBoundState(t *testing.T) {
	repository:=newMemoryRepository()
	handler:=NewHandlerWithDependencies(DeliveryDependencies{Repository:repository,Identity:fixedIdentity{}})
	call:=func(method,path,body string) *httptest.ResponseRecorder {
		t.Helper(); request:=httptest.NewRequest(method,path,bytes.NewBufferString(body)); response:=httptest.NewRecorder();handler.ServeHTTP(response,request);return response
	}
	created:=call(http.MethodPost,"/api/v1/changesets",`{"repository":"org/repo","title":"Add capability"}`)
	if created.Code!=http.StatusCreated { t.Fatalf("create status=%d body=%s",created.Code,created.Body.String()) }
	var stored storedChangesetResponse
	if err:=json.Unmarshal(created.Body.Bytes(),&stored);err!=nil{t.Fatal(err)}
	id:=stored.Changeset.ID
	revision:=call(http.MethodPost,"/api/v1/changesets/"+string(id)+"/revisions",`{"ref":"commit-1"}`)
	if revision.Code!=http.StatusOK{t.Fatalf("revision status=%d body=%s",revision.Code,revision.Body.String())}
	stored=decodeStored(t,revision)
	revisionID:=stored.Changeset.Revisions[0].ID
	evaluation:=call(http.MethodPost,"/api/v1/changesets/"+string(id)+"/evaluations",mustJSON(t,map[string]any{"revision_id":revisionID,"status":"passed","summary":"checks passed"}))
	if evaluation.Code!=http.StatusOK{t.Fatalf("evaluation status=%d body=%s",evaluation.Code,evaluation.Body.String())}
	stored=decodeStored(t,evaluation)
	evaluationID:=stored.Changeset.Evaluations[0].ID
	evidence:=call(http.MethodPost,"/api/v1/changesets/"+string(id)+"/evidence",mustJSON(t,map[string]any{"revision_id":revisionID,"evaluation_id":evaluationID,"kind":"ci","uri":"https://ci.example/run/1"}))
	if evidence.Code!=http.StatusOK{t.Fatalf("evidence status=%d body=%s",evidence.Code,evidence.Body.String())}
	review:=call(http.MethodPost,"/api/v1/changesets/"+string(id)+"/reviews",mustJSON(t,map[string]any{"revision_id":revisionID,"comment":"Please review"}))
	if review.Code!=http.StatusOK{t.Fatalf("review status=%d body=%s",review.Code,review.Body.String())}
	stored=decodeStored(t,review)
	reviewID:=stored.Changeset.Reviews[0].ID
	decision:=call(http.MethodPost,"/api/v1/changesets/"+string(id)+"/reviews/"+string(reviewID)+"/decision",`{"approved":true,"comment":"Approved"}`)
	if decision.Code!=http.StatusOK{t.Fatalf("decision status=%d body=%s",decision.Code,decision.Body.String())}
	stored=decodeStored(t,decision)
	if stored.Changeset.Reviews[0].Status!=delivery.ReviewApproved { t.Fatalf("review status=%q, want approved",stored.Changeset.Reviews[0].Status) }
	if len(stored.Changeset.Audit)!=6 { t.Fatalf("audit events=%d, want 6",len(stored.Changeset.Audit)) }
}

func decodeStored(t *testing.T,response *httptest.ResponseRecorder) storedChangesetResponse {
	t.Helper();var stored storedChangesetResponse;if err:=json.Unmarshal(response.Body.Bytes(),&stored);err!=nil{t.Fatal(err)};return stored
}
func mustJSON(t *testing.T,value any) string {
	t.Helper();encoded,err:=json.Marshal(value);if err!=nil{t.Fatal(err)};return string(encoded)
}
