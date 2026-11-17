package delivery

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type GitDiffEvaluator struct { Git *LocalGitProvider }

func (e GitDiffEvaluator) Evaluate(ctx context.Context, organizationID, repository, baseSHA, revisionSHA string) (EvaluationResult,error) {
	if e.Git == nil { return EvaluationResult{}, ErrProviderUnavailable }
	path,err:=e.Git.repositoryPath(organizationID,repository); if err!=nil{return EvaluationResult{},err}
	output,runErr:=e.Git.run(ctx,path,"diff","--check",baseSHA,revisionSHA)
	result:=EvaluationResult{Passed:runErr==nil,Summary:"Git whitespace and patch integrity checks passed"}
	if runErr!=nil { result.Summary="Git diff validation failed" }
	result.Report,_=json.Marshal(struct{
		Checks []struct{Name string `json:"name"`;Passed bool `json:"passed"`;Output string `json:"output,omitempty"`} `json:"checks"`
	}{Checks:[]struct{Name string `json:"name"`;Passed bool `json:"passed"`;Output string `json:"output,omitempty"`}{{Name:"git-diff-check",Passed:runErr==nil,Output:strings.TrimSpace(output)}}})
	if runErr!=nil { return result,fmt.Errorf("%w: %s",ErrEvaluationFailed,strings.TrimSpace(output)) }
	return result,nil
}
