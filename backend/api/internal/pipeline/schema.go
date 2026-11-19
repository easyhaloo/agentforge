package pipeline

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed workflow.schema.json
var schemaDocument []byte

var workflowSchema = func() *jsonschema.Schema {
	const resource = "urn:agentforge:pipeline:v1"
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaDocument))
	if err != nil {
		panic(err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(resource, doc); err != nil {
		panic(err)
	}
	return compiler.MustCompile(resource)
}()

// Decode checks the same JSON Schema used by the client before converting to Go types.
func Decode(raw json.RawMessage) (*Definition, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("expected a JSON workflow definition")
	}
	if err = workflowSchema.Validate(doc); err != nil {
		return nil, errors.New("definition does not match the v1 workflow schema; check field names, types, IDs and capability versions")
	}
	var d Definition
	if err = json.Unmarshal(raw, &d); err != nil {
		return nil, err
	}
	return &d, d.Validate()
}
