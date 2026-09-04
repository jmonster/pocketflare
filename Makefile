.PHONY: build deploy dev clean update-pb admin-ui-overlays proof proof-critical

build: admin-ui-overlays
	mkdir -p dist
	GOOS=js GOARCH=wasm go build -tags no_default_driver -trimpath -ldflags="-s -w" -o dist/app.wasm ./cmd/pocketflare
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" dist/
	git apply --directory=dist runtime/wasm_exec.patch
	cp worker.mjs runtime.mjs app-do.mjs realtime-do.mjs smtp-transport.mjs dist/

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

proof: proof-critical
proof-critical:
	./scripts/proof-critical.sh
