FROM rust:1.96-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release -j 1

FROM debian:bookworm-slim
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /app/target/release/xiguifei-kitchen-api /usr/local/bin/xiguifei-kitchen-api
EXPOSE 8787
CMD ["xiguifei-kitchen-api"]
