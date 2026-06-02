//go:build js && wasm

package adapter

import (
	"net/http"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/syumai/workers/cloudflare"
)

// ── In-memory state for the full scheduled-event proof ──

var (
	scheduledProofFired atomic.Bool
	scheduledProofJobID string
)

const scheduledProofJobExpr = "* * * * *"

// registerProofCronRoute exposes proof endpoints that validate PocketBase
// cron execution in a real Worker. Gated behind POCKETFLARE_ENABLE_PROOF_ROUTES=1.
//
//   POST /proof/cron           — registers a temp job, calls RunDue(now), returns {ran}.
//   POST /proof/cron/scheduled  — sets up a persistent job that flips a flag when due.
//   GET  /proof/cron/scheduled  — returns whether the persistent job has fired.
//   DELETE /proof/cron/scheduled — removes the persistent job.
func registerProofCronRoute(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {
	if cloudflare.Getenv("POCKETFLARE_ENABLE_PROOF_ROUTES") != "1" {
		return
	}

	rg.POST("/proof/cron", func(e *core.RequestEvent) error {
		pb, ok := app.(*pocketbase.PocketBase)
		if !ok {
			return e.InternalServerError("cron proof requires PocketBase app", nil)
		}

		var fired atomic.Bool
		jobID := "proof-cron-" + time.Now().UTC().Format("20060102T150405.000")

		pb.Cron().MustAdd(jobID, "* * * * *", func() {
			fired.Store(true)
		})
		defer pb.Cron().Remove(jobID)

		pb.Cron().RunDue(time.Now().UTC())

		// cron.RunDue spawns goroutines; give them a moment.
		time.Sleep(100 * time.Millisecond)

		return e.JSON(http.StatusOK, map[string]any{
			"ran":       fired.Load(),
			"jobsTotal": pb.Cron().Total(),
		})
	}).Bind(apis.RequireSuperuserAuth())

	// ── Full scheduled-event proof ──
	// These routes work together with the wrangler dev
	// /cdn-cgi/handler/scheduled endpoint, which triggers the Worker's
	// scheduled() handler, which calls binding.runScheduler → Go callback
	// → pb.Cron().RunDue(ev.ScheduledTime).
	//
	// Flow:
	//   1. POST   /proof/cron/scheduled   — register persistent job
	//   2. curl   /cdn-cgi/handler/scheduled — trigger Worker scheduled event
	//   3. GET    /proof/cron/scheduled   — verify job fired
	//   4. DELETE /proof/cron/scheduled   — clean up

	rg.POST("/proof/cron/scheduled", func(e *core.RequestEvent) error {
		pb, ok := app.(*pocketbase.PocketBase)
		if !ok {
			return e.InternalServerError("cron proof requires PocketBase app", nil)
		}

		if scheduledProofJobID != "" {
			pb.Cron().Remove(scheduledProofJobID)
		}

		scheduledProofFired.Store(false)
		scheduledProofJobID = "proof-cron-scheduled-" + time.Now().UTC().Format("20060102T150405.000")

		pb.Cron().MustAdd(scheduledProofJobID, scheduledProofJobExpr, func() {
			scheduledProofFired.Store(true)
		})

		return e.JSON(http.StatusOK, map[string]any{
			"setup":     true,
			"jobID":     scheduledProofJobID,
			"jobsTotal": pb.Cron().Total(),
		})
	}).Bind(apis.RequireSuperuserAuth())

	rg.GET("/proof/cron/scheduled", func(e *core.RequestEvent) error {
		pb, ok := app.(*pocketbase.PocketBase)
		if !ok {
			return e.InternalServerError("cron proof requires PocketBase app", nil)
		}

		return e.JSON(http.StatusOK, map[string]any{
			"fired":     scheduledProofFired.Load(),
			"jobID":     scheduledProofJobID,
			"jobsTotal": pb.Cron().Total(),
		})
	}).Bind(apis.RequireSuperuserAuth())

	rg.DELETE("/proof/cron/scheduled", func(e *core.RequestEvent) error {
		pb, ok := app.(*pocketbase.PocketBase)
		if !ok {
			return e.InternalServerError("cron proof requires PocketBase app", nil)
		}

		if scheduledProofJobID != "" {
			pb.Cron().Remove(scheduledProofJobID)
		}
		scheduledProofJobID = ""
		scheduledProofFired.Store(false)

		return e.JSON(http.StatusOK, map[string]any{
			"ok":        true,
			"jobsTotal": pb.Cron().Total(),
		})
	}).Bind(apis.RequireSuperuserAuth())
}
