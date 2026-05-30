.PHONY: build deploy clean update-pb

build:
	mkdir -p dist
	GOOS=js GOARCH=wasm go build -tags no_default_driver -trimpath -ldflags="-s -w" -o dist/app.wasm ./cmd/pocketflare
	cp wasm_exec.js worker.mjs runtime.mjs dist/

deploy:
	pnpm exec wrangler deploy

dev:
	pnpm exec wrangler dev

clean:
	rm -rf dist/

update-pb:
	./scripts/update-pb.sh
