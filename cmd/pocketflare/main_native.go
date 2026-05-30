//go:build !js

package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/pocketflare/pocketflare/adapter"
)

func main() {
	pb, router, err := adapter.New(adapter.Config{
		AppName: "pocketflare",
		AppURL:  "http://localhost:8090",
		DataDir: "./pb_data",
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

	addr := ":8090"
	log.Printf("Listening on %s", addr)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("Shutting down...")
		if err := pb.ResetBootstrapState(); err != nil {
			log.Printf("cleanup error: %v", err)
		}
		os.Exit(0)
	}()

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
