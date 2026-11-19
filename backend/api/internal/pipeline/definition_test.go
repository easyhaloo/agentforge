package pipeline

import (
	"encoding/json"
	"testing"
)

func example() Definition {
	return Definition{APIVersion: APIVersion, Name: "release", Stages: []Stage{{ID: "check", Jobs: []Job{{ID: "review", Steps: []Step{{ID: "sign", Uses: Approval}}}}}, {ID: "ship", Jobs: []Job{{ID: "release", Steps: []Step{{ID: "authorize", Uses: Approval}}}}}}}
}
func TestGraphValidation(t *testing.T) {
	for name, change := range map[string]func(*Definition){"duplicate ID": func(d *Definition) { d.Stages[1].ID = "check" }, "unknown capability": func(d *Definition) { d.Stages[0].Jobs[0].Steps[0].Uses = "unregistered" }, "missing dependency": func(d *Definition) { d.Stages[1].DependsOn = []string{"absent"} }, "implicit cycle": func(d *Definition) { d.Stages[0].DependsOn = []string{"ship"} }, "bad default": func(d *Definition) {
		d.Parameters = []Parameter{{Name: "token", Type: "secretRef", Default: json.RawMessage(`"plaintext"`)}}
	}} {
		t.Run(name, func(t *testing.T) {
			d := example()
			change(&d)
			if d.Validate() == nil {
				t.Fatal("accepted invalid workflow")
			}
		})
	}
	d := example()
	d.Stages[0].DependsOn = []string{"ship"}
	d.Stages[1].DependsOn = []string{}
	raw, _ := json.Marshal(d)
	var roundtrip Definition
	if err := json.Unmarshal(raw, &roundtrip); err != nil {
		t.Fatal(err)
	}
	if err := roundtrip.Validate(); err != nil {
		t.Fatal(err)
	}
}
func TestTypedInputs(t *testing.T) {
	for _, tc := range []struct{ kind, good, bad string }{{"integer", "42", "9007199254740991.1"}, {"number", "0.5", "null"}, {"string", `""`, `1`}, {"boolean", "false", `"false"`}, {"branch", `"feature/work"`, `"../head"`}, {"branches", `["main"]`, `[false]`}, {"repository", `"team/app"`, `"/tmp/app"`}, {"secretRef", `"secret://deploy-key"`, `"private-value"`}, {"choice", `"safe"`, `"other"`}} {
		t.Run(tc.kind, func(t *testing.T) {
			p := Parameter{Name: "input", Type: tc.kind, Required: true, Override: true}
			if tc.kind == "choice" {
				p.Choices = []string{"safe"}
			}
			d := example()
			d.Parameters = []Parameter{p}
			if err := d.Validate(); err != nil {
				t.Fatal(err)
			}
			if err := d.ValidateInputs(map[string]json.RawMessage{"input": json.RawMessage(tc.good)}); err != nil {
				t.Fatal(err)
			}
			for _, m := range []map[string]json.RawMessage{nil, {"input": json.RawMessage(tc.bad)}, {"input": json.RawMessage(tc.good), "unknown": json.RawMessage("true")}} {
				if d.ValidateInputs(m) == nil {
					t.Fatal("accepted invalid inputs")
				}
			}
			d.Parameters[0].Default = json.RawMessage(tc.good)
			d.Parameters[0].Override = false
			if d.ValidateInputs(nil) != nil || d.ValidateInputs(map[string]json.RawMessage{"input": json.RawMessage(tc.good)}) == nil {
				t.Fatal("locked default was not enforced")
			}
		})
	}
}

func TestStepSecretBindings(t *testing.T) {
	d := example()
	d.Parameters = []Parameter{{Name: "api", Type: "secretRef"}, {Name: "plain", Type: "string"}}
	step := &d.Stages[0].Jobs[0].Steps[0]
	step.SecretParams = []string{"api"}
	if d.Validate() == nil {
		t.Fatal("bound secret to approval")
	}
	step.Uses = ContainerCheck
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, refs := range [][]string{{"plain"}, {"absent"}, {"api", "api"}} {
		step.SecretParams = refs
		if d.Validate() == nil {
			t.Fatal("accepted invalid secret binding")
		}
	}
}
