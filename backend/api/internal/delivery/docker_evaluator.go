package delivery

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// DockerEvaluator executes an operator-configured validation command in a bounded,
// network-isolated container with the registered repository mounted read-only.
type DockerEvaluator struct {
	Git *LocalGitProvider
	Image string
	Command string
	Timeout time.Duration
}

func (e DockerEvaluator) Evaluate(ctx context.Context,job EvaluationJob)(EvaluationResult,error) {
	if e.Git==nil||strings.TrimSpace(e.Image)==""||strings.TrimSpace(e.Command)=="" {return EvaluationResult{},ErrProviderUnavailable}
	path,err:=e.Git.repositoryPath(ctx,job.OrganizationID,job.Repository);if err!=nil{return EvaluationResult{},err}
	timeout:=e.Timeout;if timeout<=0{timeout=10*time.Minute}
	runCtx,cancel:=context.WithTimeout(ctx,timeout);defer cancel()
	args:=[]string{
		"run","--rm","--pull=never","--network=none","--read-only",
		"--cap-drop=ALL","--security-opt=no-new-privileges","--pids-limit=256",
		"--memory=2g","--cpus=2","--user=65532:65532",
		"--tmpfs","/tmp:rw,nosuid,nodev,size=512m",
		"--mount","type=bind,src="+path+",dst=/workspace,readonly",
		"--workdir","/workspace",
		"--env","HOME=/tmp","--env","GOCACHE=/tmp/go-cache","--env","GOMODCACHE=/tmp/go-mod-cache",
		"--env","AGENTFORGE_BASE_SHA="+job.BaseSHA,"--env","AGENTFORGE_REVISION_SHA="+job.RevisionSHA,
		e.Image,"/bin/sh","-lc",e.Command,
	}
	command:=exec.CommandContext(runCtx,"docker",args...)
	command.Env=[]string{"PATH="+os.Getenv("PATH"),"HOME="+os.TempDir()}
	output,runErr:=command.CombinedOutput()
	result:=EvaluationResult{JobID:job.ID,OrganizationID:job.OrganizationID,ChangesetID:job.ChangesetID,RevisionID:job.RevisionID,BaseSHA:job.BaseSHA,RevisionSHA:job.RevisionSHA,Passed:runErr==nil,Summary:"Sandboxed repository validation passed"}
	if runErr!=nil {result.Summary="Sandboxed repository validation failed"}
	result.Report,_=json.Marshal(struct{
		Image string `json:"image"`
		Command string `json:"command"`
		BaseSHA string `json:"base_sha"`
		RevisionSHA string `json:"revision_sha"`
		Passed bool `json:"passed"`
		Output string `json:"output"`
	}{e.Image,e.Command,job.BaseSHA,job.RevisionSHA,result.Passed,strings.TrimSpace(string(output))})
	if runErr!=nil {return result,fmt.Errorf("%w: %s",ErrEvaluationFailed,strings.TrimSpace(string(output)))}
	return result,nil
}

var _ Evaluator = DockerEvaluator{}
