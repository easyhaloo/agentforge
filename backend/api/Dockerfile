FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/agentforge-api ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/agentforge-api /agentforge-api

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/agentforge-api"]
