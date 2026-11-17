package identity

import "testing"

func TestGenerateCredentialsProducesIndependentOpaqueTokens(t *testing.T) {
	first, err := GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	second, err := GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if len(first.SessionToken) < 40 || len(first.CSRFToken) < 40 {
		t.Fatal("generated credentials must contain at least 256 bits of entropy")
	}
	if first.SessionToken == first.CSRFToken || first.SessionToken == second.SessionToken ||
		first.CSRFToken == second.CSRFToken {
		t.Fatal("generated credentials must be independent")
	}
	if HashToken(first.SessionToken) == first.SessionToken {
		t.Fatal("stored token hash must not equal the raw session token")
	}
	if HashToken(first.SessionToken) != HashToken(first.SessionToken) {
		t.Fatal("token hashing must be deterministic")
	}
}
