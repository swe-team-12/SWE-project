# Upstream MinIO stopped publishing a pullable community image.
# Build the pinned upstream security release for the local demo instead.
FROM golang:1.24.8-alpine AS builder

ENV GOTOOLCHAIN=local
RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /go/bin/minio /usr/local/bin/minio

EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
