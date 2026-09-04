// Package adapter bootstraps a PocketBase instance for the Workers runtime.
//
// This file contains the Durable Object realtime bridge. The DO holds SSE
// connections open; PocketBase handles auth, subscription matching, access
// control, and message formatting. A sync protocol ensures subscriptions
// are visible across Worker isolates.
//
// IMPORTANT — Two realtime paths, both necessary:
//
//   Production: Go↔DO via stub.Fetch() works on deployed Workers.
//   GET  → stub.fetch → RealtimeDO (native SSE)
//   POST → Go → DOClient.Send → stub.fetch → DO /__send
//
//   Local dev: Go↔DO via stub.Fetch() does NOT work in wrangler dev.
//   The syumai/workers Go→JS DO bridge does not route to the in-process
//   DO in wrangler dev. The JS-side bridge (POCKETFLARE_REALTIME_WORKER_
//   BRIDGE=1 in worker.mjs) handles SSE and event forwarding locally.
//   Do not remove the JS bridge — it is proven necessary by
//   scripts/proof-realtime.sh (19/19 pass with it, 8/19 fail without).

package adapter

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
	"github.com/syumai/workers/cloudflare"
)

var (
	realtimeDONamespace *cloudflare.DurableObjectNamespace
	realtimeDOStub      *cloudflare.DurableObjectStub
)

func initRealtimeDO(app core.App) {
	ns, err := cloudflare.NewDurableObjectNamespace("REALTIME_DO")
	if err != nil {
		log.Printf("[realtime] REALTIME_DO binding not available: %v", err)
		return
	}
	realtimeDONamespace = ns

	id := realtimeDONamespace.IdFromName("hub")
	stub, err := realtimeDONamespace.Get(id)
	if err != nil {
		log.Printf("[realtime] DO stub error: %v", err)
		return
	}
	realtimeDOStub = stub

	// Provider: creates a DOClient when a client subscribes via
	// POST /api/realtime but isn't yet in the local broker.
	apis.WasmRealtimeClientProvider = func(_ core.App, clientId string) (subscriptions.Client, error) {
		return newDOClient(clientId), nil
	}

	// After a client subscribes, push its subscriptions + auth to the DO
	// so other isolates can discover them.
	app.OnRealtimeSubscribeRequest().Bind(&hook.Handler[*core.RealtimeSubscribeRequestEvent]{
		Func: func(e *core.RealtimeSubscribeRequestEvent) error {
			err := e.Next()
			if err == nil && realtimeDOStub != nil {
				syncSubscriptionToDO(e.Client)
			}
			return err
		},
	})

	// Before PocketBase's broadcast hooks fire (priority -99), pull
	// subscriptions from the DO into the local broker. This ensures
	// broadcasts pick up clients that subscribed in other isolates.
	bindBroadcastSync(app)
}

// bindBroadcastSync registers sync-before-broadcast hooks at priority -98
// so they fire just before PocketBase's realtime broadcast hooks (-99).
func bindBroadcastSync(app core.App) {
	sync := func() {
		if realtimeDOStub != nil {
			syncSubscriptionsFromDO(app)
		}
	}

	app.OnModelAfterCreateSuccess().Bind(&hook.Handler[*core.ModelEvent]{
		Func:     func(e *core.ModelEvent) error { sync(); return e.Next() },
		Priority: -98,
	})
	app.OnModelAfterUpdateSuccess().Bind(&hook.Handler[*core.ModelEvent]{
		Func:     func(e *core.ModelEvent) error { sync(); return e.Next() },
		Priority: -98,
	})
	app.OnModelAfterDeleteSuccess().Bind(&hook.Handler[*core.ModelEvent]{
		Func:     func(e *core.ModelEvent) error { sync(); return e.Next() },
		Priority: -98,
	})
}

// ── DO sync protocol ─────────────────────────────────────────────────────

type doSubscription struct {
	ClientId           string   `json:"clientId"`
	Subscriptions      []string `json:"subscriptions"`
	AuthRecordId       string   `json:"authRecordId,omitempty"`
	AuthCollectionName string   `json:"authCollectionName,omitempty"`
}

// syncSubscriptionToDO pushes a client's subscriptions and auth info to the
// DO so other isolates can discover them during broadcast.
func syncSubscriptionToDO(client subscriptions.Client) {
	subs := client.Subscriptions()
	subList := make([]string, 0, len(subs))
	for k := range subs {
		subList = append(subList, k)
	}

	payload := map[string]any{
		"clientId":      client.Id(),
		"subscriptions": subList,
	}

	if auth, ok := client.Get(apis.RealtimeClientAuthKey).(*core.Record); ok && auth != nil {
		payload["authRecordId"] = auth.Id
		payload["authCollectionName"] = auth.Collection().Name
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "https://do.local/__subscribe", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	go func() {
		resp, err := realtimeDOStub.Fetch(req)
		if err != nil {
			return
		}
		resp.Body.Close()
	}()
}

// syncSubscriptionsFromDO pulls all subscriptions from the DO and registers
// any unseen clients in the local broker. Existing clients are left alone
// (they already have correct auth from the subscription POST in this isolate).
func syncSubscriptionsFromDO(app core.App) {
	req, _ := http.NewRequest("GET", "https://do.local/__subscriptions", nil)
	resp, err := realtimeDOStub.Fetch(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var subs []doSubscription
	if err := json.NewDecoder(resp.Body).Decode(&subs); err != nil {
		return
	}

	for _, s := range subs {
		if _, err := app.SubscriptionsBroker().ClientById(s.ClientId); err == nil {
			continue // already in local broker
		}

		client := newDOClient(s.ClientId)
		app.SubscriptionsBroker().Register(client)

		// Restore subscriptions so the local broker matches the DO state.
		if len(s.Subscriptions) > 0 {
			client.Subscribe(s.Subscriptions...)
		}

		// Restore auth record if available so access control works.
		if s.AuthRecordId != "" && s.AuthCollectionName != "" {
			if col, err := app.FindCachedCollectionByNameOrId(s.AuthCollectionName); err == nil {
				if rec, err := app.FindRecordById(col, s.AuthRecordId); err == nil {
					client.Set(apis.RealtimeClientAuthKey, rec)
				}
			}
		}
	}
}

// ── DOClient ──────────────────────────────────────────────────────────────

// DOClient wraps subscriptions.DefaultClient, overriding the transport
// methods so messages are delivered through the Durable Object instead
// of an in-memory Go channel. All subscription parsing, prefix matching,
// and context storage is inherited from DefaultClient unchanged.
type DOClient struct {
	*subscriptions.DefaultClient
	id string
}

func newDOClient(clientId string) *DOClient {
	return &DOClient{DefaultClient: subscriptions.NewDefaultClient(), id: clientId}
}

// Id uses the identifier assigned by the external connection manager.
func (c *DOClient) Id() string { return c.id }

// Channel returns nil — DO-based clients don't use in-memory channels.
// This channel is only consumed by the SSE handler (realtimeConnect),
// which is intercepted by worker.mjs and never runs in Go.
func (c *DOClient) Channel() chan subscriptions.Message {
	return nil
}

// Send delivers a message to the client via the Durable Object.
// Called by PocketBase's broadcast hooks (realtimeBroadcastRecord).
//
// Messages are fire-and-forget. If the DO returns 404 the client
// connection is gone and we mark this client discarded so future
// broadcasts skip it.
func (c *DOClient) Send(m subscriptions.Message) {
	if c.IsDiscarded() || realtimeDOStub == nil {
		return
	}

	body, err := json.Marshal(map[string]string{
		"clientId": c.Id(),
		"event":    m.Name,
		"data":     string(m.Data),
	})
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", "https://do.local/__send", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	go func() {
		resp, err := realtimeDOStub.Fetch(req)
		if err != nil {
			return
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			c.Discard()
		}
	}()
}
