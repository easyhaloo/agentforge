package delivery

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type LocalEvidenceStore struct { Root string }

func NewLocalEvidenceStore(root string) (*LocalEvidenceStore,error) {
	if strings.TrimSpace(root)=="" { return nil,ErrProviderUnavailable }
	absolute,err:=filepath.Abs(root); if err!=nil{return nil,err}
	if err=os.MkdirAll(absolute,0700);err!=nil{return nil,err}
	absolute,err=filepath.EvalSymlinks(absolute);if err!=nil{return nil,err}
	return &LocalEvidenceStore{Root:absolute},nil
}

func (s *LocalEvidenceStore) Put(ctx context.Context, organizationID, changesetID string, content []byte) (EvidenceArtifact,error) {
	if err:=ctx.Err();err!=nil{return EvidenceArtifact{},err}
	if s==nil || s.Root=="" || organizationID=="" || changesetID=="" || len(content)==0 { return EvidenceArtifact{},errors.New("invalid evidence artifact") }
	sum:=sha256.Sum256(content); digest:=hex.EncodeToString(sum[:])
	orgKey:=sha256.Sum256([]byte(organizationID)); changesetKey:=sha256.Sum256([]byte(changesetID))
	directory:=filepath.Join(s.Root,hex.EncodeToString(orgKey[:]),hex.EncodeToString(changesetKey[:]))
	if err:=os.MkdirAll(directory,0700);err!=nil{return EvidenceArtifact{},err}
	path:=filepath.Join(directory,digest+".json")
	if err:=os.WriteFile(path,content,0600);err!=nil{return EvidenceArtifact{},err}
	return EvidenceArtifact{URI:"artifact://"+hex.EncodeToString(orgKey[:])+"/"+hex.EncodeToString(changesetKey[:])+"/"+digest,SHA256:digest,Size:int64(len(content))},nil
}
