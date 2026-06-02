# ── Stage 1: install cargo-chef ───────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

# ── Stage 2: compute the dependency recipe ────────────────────────────────────
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 3: build dependencies (cached layer), then the binary ───────────────
FROM chef AS builder

# ring (pulled in by rustls/sqlx) needs a C compiler on Linux
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

COPY --from=planner /app/recipe.json recipe.json
# This layer is cached as long as Cargo.lock / Cargo.toml files are unchanged
RUN cargo chef cook --release --recipe-path recipe.json

COPY . .
RUN cargo build --release -p kairox-api

# ── Stage 4: minimal runtime image ────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/kairox-api     /usr/local/bin/kairox-api
COPY --from=builder /app/crates/kairox-api/migrations  /app/migrations

WORKDIR /app

ENV BIND_ADDR=0.0.0.0:3000
ENV MIGRATIONS_PATH=/app/migrations

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["/usr/local/bin/kairox-api"]
