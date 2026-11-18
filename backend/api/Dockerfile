FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/agentforge-api ./cmd/server

# Build --target integration-api when this API serves Git-backed pipelines.
FROM alpine:3.23 AS integration-api
RUN apk add --no-cache git ca-certificates
COPY --from=build /out/agentforge-api /agentforge-api
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/agentforge-api"]

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/agentforge-api /agentforge-api

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/agentforge-api"]
