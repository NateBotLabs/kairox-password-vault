# kairox-password-vault dev commands
# Install just: cargo install just
# Usage: just <recipe>

set dotenv-load := true   # auto-load .env

default: check

# ── Rust ──────────────────────────────────────────────────────────────────────

# Check all crates for errors (fast, no binary produced)
check:
    cargo check --workspace

# Build all crates
build:
    cargo build --workspace

# Build optimised release binary
release:
    cargo build --release -p kairox-api

# Run all tests
test:
    cargo test --workspace

# Run tests for a specific crate (e.g. `just test-crate kairox-crypto`)
test-crate crate:
    cargo test -p {{crate}}

# Format all code
fmt:
    cargo fmt --all

# Lint (treat warnings as errors)
clippy:
    cargo clippy --workspace -- -D warnings

# Apply clippy auto-fixes
fix:
    cargo fix --workspace --allow-dirty

# ── Local dev database ────────────────────────────────────────────────────────

DB_NAME   := "kairox"
DB_USER   := "kairox"
DB_PASS   := "kairox"
DB_PORT   := "5432"
CONTAINER := "kairox-dev-db"

# Start a local Postgres container (idempotent)
db-start:
    docker run -d --name {{CONTAINER}} \
        -e POSTGRES_USER={{DB_USER}} \
        -e POSTGRES_PASSWORD={{DB_PASS}} \
        -e POSTGRES_DB={{DB_NAME}} \
        -p {{DB_PORT}}:5432 \
        postgres:16-alpine || docker start {{CONTAINER}}

# Stop and remove the dev database container
db-stop:
    docker stop {{CONTAINER}} && docker rm {{CONTAINER}}

# Open a psql shell into the dev database
db-shell:
    docker exec -it {{CONTAINER}} psql -U {{DB_USER}} -d {{DB_NAME}}

# ── API server ────────────────────────────────────────────────────────────────

# Run the API server locally (requires db-start and a .env file)
dev:
    cargo run -p kairox-api

# Run with debug logging
dev-debug:
    RUST_LOG=kairox_api=debug,tower_http=debug cargo run -p kairox-api

# ── WASM crypto SDK ───────────────────────────────────────────────────────────

# Build the browser WASM package into sdk/node_modules/kairox-crypto-wasm
# Requires: cargo install wasm-pack
wasm:
    wasm-pack build crates/kairox-crypto \
        --target web \
        --out-dir ../../sdk/node_modules/kairox-crypto-wasm \
        --out-name index \
        --features wasm \
        --release

# Build WASM targeting Node.js (for testing / SSR)
wasm-node:
    wasm-pack build crates/kairox-crypto \
        --target nodejs \
        --out-dir ../../sdk/node_modules/kairox-crypto-wasm-node \
        --out-name index \
        --features wasm \
        --release

# Run WASM-specific tests in a headless browser
wasm-test:
    wasm-pack test crates/kairox-crypto --headless --chrome --features wasm

# ── TypeScript SDK ────────────────────────────────────────────────────────────

# Install SDK npm dependencies (run once, or after wasm rebuild)
sdk-install:
    cd sdk && npm install

# Type-check the SDK without emitting output
sdk-check:
    cd sdk && npx tsc --noEmit

# Build the SDK (output to sdk/dist/)
sdk-build: wasm
    cd sdk && npm run build

# Run SDK tests (vitest)
sdk-test:
    cd sdk && npm test

# Full SDK dev cycle: build WASM → typecheck → test
sdk-dev: sdk-build sdk-check sdk-test

# ── Docker ────────────────────────────────────────────────────────────────────

# Build the Docker image
docker-build:
    docker build -t kairox-api .

# Start all services (API + Postgres) with Docker Compose
up:
    docker compose up -d

# Stop and remove containers (keeps volumes)
down:
    docker compose down

# Destroy everything including the database volume
down-volumes:
    docker compose down -v

# Tail API server logs
logs:
    docker compose logs -f api

# ── React web app ────────────────────────────────────────────────────────────

# Install web app npm dependencies
web-install:
    cd web && npm install

# Type-check the web app
web-check:
    cd web && npx tsc --noEmit

# Start the Vite dev server (hot-reload, proxies /api → localhost:3000)
web-dev:
    cd web && npm run dev

# Production build (outputs to web/dist/)
web-build:
    cd web && npm run build

# ── Tauri desktop app ────────────────────────────────────────────────────────

# Start Tauri dev mode (hot-reload — starts the Vite server + Tauri window)
# Requires: cargo install tauri-cli  OR  cd web && npm install (installs @tauri-apps/cli)
tauri-dev:
    cd web && npx tauri dev

# Package the desktop app for the current OS
tauri-build:
    cd web && npm run build && npx tauri build

# Check the Tauri Rust backend without starting the full app
tauri-check:
    cargo check -p kairox-desktop

# ── Combined setup & dev ──────────────────────────────────────────────────────

# One-time setup: build WASM, install all JS deps
setup: wasm sdk-install web-install

# Full dev environment: Postgres + API + web in background
# Requires: tmux  (or run each command in its own terminal)
dev-all: db-start
    @echo "Start these in separate terminals:"
    @echo "  just dev         # Rust API server"
    @echo "  just web-dev     # Vite web app (http://localhost:5173)"

# ── Housekeeping ──────────────────────────────────────────────────────────────

# Remove build artefacts
clean:
    cargo clean
    rm -rf crates/kairox-crypto/pkg crates/kairox-crypto/pkg-node

# Print dependency tree
deps:
    cargo tree --workspace
