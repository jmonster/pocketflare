.PHONY: build deploy dev clean update-pb admin-ui-overlays brand proof proof-critical

build:
	mkdir -p dist
	GOOS=js GOARCH=wasm go build -tags no_default_driver -trimpath -ldflags="-s -w" -o dist/app.wasm ./cmd/pocketflare
	cp wasm_exec.js worker.mjs runtime.mjs app-do.mjs realtime-do.mjs smtp-transport.mjs dist/

deploy: build
	pnpm exec wrangler deploy

dev:
	pnpm exec wrangler dev

clean:
	rm -rf dist/

update-pb:
	./scripts/update-pb.sh

admin-ui-overlays:
	./scripts/apply-admin-ui-overlays.sh

brand: admin-ui-overlays

proof: proof-critical
proof-critical:
	./scripts/proof-critical.sh
