package delivery

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalEvidenceStoreWritesContentAddressedPrivateArtifact(t *testing.T) {
	root:=t.TempDir()
	store,err:=NewLocalEvidenceStore(root);if err!=nil{t.Fatal(err)}
	payload:=[]byte(`{"checks":[{"name":"diff","passed":true}]}`)
	first,err:=store.Put(context.Background(),"org/private","cs/one",payload);if err!=nil{t.Fatal(err)}
	second,err:=store.Put(context.Background(),"org/private","cs/one",payload);if err!=nil{t.Fatal(err)}
	if first.SHA256!=second.SHA256||first.URI!=second.URI{t.Fatalf("same content must have stable artifact identity: %#v %#v",first,second)}
	if first.Size!=int64(len(payload)){t.Fatalf("size=%d",first.Size)}
	if filepath.IsAbs(first.URI)||len(first.URI)<len("artifact://"){t.Fatalf("artifact URI must not expose an absolute filesystem path: %q",first.URI)}
	entries,err:=os.ReadDir(root);if err!=nil{t.Fatal(err)}
	if len(entries)!=1{t.Fatalf("hashed organization directory count=%d",len(entries))}
}
