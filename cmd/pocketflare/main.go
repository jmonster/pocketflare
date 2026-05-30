//go:build js && wasm

package main

import (
	"log"

	"github.com/pocketflare/pocketflare/adapter"
	"github.com/syumai/workers"
)

func main() {
	pb, router, err := adapter.New(adapter.Config{
		DataDir:       "/tmp/pb_data",
		AdminEmail:    "admin@test.com",
		AdminPassword: "test123456",
	})
	if err != nil {
		log.Fatalf("failed to initialize PocketBase: %v", err)
	}
	defer func() {
		if err := pb.ResetBootstrapState(); err != nil {
			log.Printf("cleanup error: %v", err)
		}
	}()

	handler, err := router.BuildMux()
	if err != nil {
		log.Fatalf("failed to build router: %v", err)
	}

	workers.ServeNonBlock(handler)
	workers.Ready()
	select {}
}
