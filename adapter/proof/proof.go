//go:build js && wasm

// Package proof registers Pocketflare proof endpoints. All routes are gated
// behind POCKETFLARE_ENABLE_PROOF_ROUTES=1.
package proof

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/syumai/workers/cloudflare"
)

// Register adds all Pocketflare proof routes to the router.
func Register(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {
	if cloudflare.Getenv("POCKETFLARE_ENABLE_PROOF_ROUTES") != "1" {
		return
	}

	registerCopyRoute(app, rg)
	registerCronRoutes(app, rg)
}

// ── Copy proof ────────────────────────────────────────────────────────────

const proofCopyMaxSize = 20 * 1024 * 1024 // 20 MiB

type proofCopyRequest struct {
	Size        int    `json:"size"`
	ContentType string `json:"contentType"`
}

type proofCopyResponse struct {
	OK               bool   `json:"ok"`
	SrcKey           string `json:"srcKey"`
	DstKey           string `json:"dstKey"`
	Size             int    `json:"size"`
	ContentType      string `json:"contentType"`
	SrcExists        bool   `json:"srcExists"`
	DstExists        bool   `json:"dstExists"`
	BytesMatch       bool   `json:"bytesMatch"`
	ContentTypeMatch bool   `json:"contentTypeMatch"`
	CopyPath         string `json:"copyPath"`
	Error            string `json:"error,omitempty"`
}

func registerCopyRoute(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {
	rg.POST("/proof/copy", func(e *core.RequestEvent) (handlerErr error) {
		copyPath := "unknown"
		phase := "start"
		defer func() {
			if r := recover(); r != nil {
				handlerErr = e.JSON(http.StatusOK, proofCopyResponse{
					OK:       false,
					CopyPath: copyPath,
					Error:    fmt.Sprintf("panic at %s: %v", phase, r),
				})
			}
		}()

		body := new(proofCopyRequest)
		phase = "bind-body"
		if err := e.BindBody(body); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if body.Size <= 0 || body.Size > proofCopyMaxSize {
			return e.BadRequestError(
				fmt.Sprintf("size must be 1-%d bytes", proofCopyMaxSize),
				nil,
			)
		}
		if body.ContentType == "" {
			body.ContentType = "application/octet-stream"
		}

		phase = "select-copy-path"
		copyPath = "streaming-fallback"
		fail := func(msg string, err error, srcKey string, dstKey string) error {
			detail := msg
			if err != nil {
				detail = fmt.Sprintf("%s: %v", msg, err)
			}
			return e.JSON(http.StatusOK, proofCopyResponse{
				OK:          false,
				SrcKey:      srcKey,
				DstKey:      dstKey,
				Size:        body.Size,
				ContentType: body.ContentType,
				CopyPath:    copyPath,
				Error:       detail,
			})
		}

		phase = "new-filesystem"
		fsys, err := app.NewFilesystem()
		if err != nil {
			return fail("failed to create filesystem", err, "", "")
		}
		defer fsys.Close()

		prefix := fmt.Sprintf("proof-copy-src-%s-", randomHex(8))
		content := make([]byte, body.Size)
		copy(content, prefix)
		fillPrintable(content[len(prefix):])

		suffix := randomHex(6)
		srcKey := "proof-copy/src-" + suffix
		dstKey := "proof-copy/dst-" + suffix

		defer func() {
			_ = fsys.Delete(srcKey)
			_ = fsys.Delete(dstKey)
		}()

		phase = "upload-source"
		if err := fsys.Upload(content, srcKey); err != nil {
			return fail("upload source failed", err, srcKey, dstKey)
		}

		phase = "copy"
		if err := fsys.Copy(srcKey, dstKey); err != nil {
			return fail("copy failed", err, srcKey, dstKey)
		}

		phase = "source-attributes"
		srcAttrs, srcErr := fsys.Attributes(srcKey)
		srcExists := srcErr == nil

		phase = "destination-attributes"
		dstAttrs, dstErr := fsys.Attributes(dstKey)
		dstExists := dstErr == nil

		contentTypeMatch := false
		if srcExists && dstExists {
			contentTypeMatch = srcAttrs.ContentType == dstAttrs.ContentType
		}

		bytesMatch := false
		if dstExists {
			phase = "read-destination"
			dstReader, err := fsys.GetReader(dstKey)
			if err == nil {
				defer dstReader.Close()
				dstContent := make([]byte, body.Size)
				if _, err := io.ReadFull(dstReader, dstContent); err == nil {
					bytesMatch = bytes.Equal(content, dstContent)
				}
			}
		}

		resp := proofCopyResponse{
			OK:               srcExists && dstExists && bytesMatch && contentTypeMatch,
			SrcKey:           srcKey,
			DstKey:           dstKey,
			Size:             body.Size,
			ContentType:      body.ContentType,
			SrcExists:        srcExists,
			DstExists:        dstExists,
			BytesMatch:       bytesMatch,
			ContentTypeMatch: contentTypeMatch,
			CopyPath:         copyPath,
		}

		if srcErr != nil {
			resp.Error = fmt.Sprintf("src attributes: %v", srcErr)
		} else if dstErr != nil {
			resp.Error = fmt.Sprintf("dst attributes: %v", dstErr)
		} else if !bytesMatch {
			resp.Error = "destination bytes do not match source"
		} else if !contentTypeMatch {
			resp.Error = "destination content type does not match source"
		}

		return e.JSON(http.StatusOK, resp)
	}).Bind(apis.RequireSuperuserAuth())
}

// ── Cron proof ────────────────────────────────────────────────────────────

var (
	scheduledProofFired atomic.Bool
	scheduledProofJobID string
)

const scheduledProofJobExpr = "* * * * *"

func registerCronRoutes(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {
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
		time.Sleep(100 * time.Millisecond)

		return e.JSON(http.StatusOK, map[string]any{
			"ran":       fired.Load(),
			"jobsTotal": pb.Cron().Total(),
		})
	}).Bind(apis.RequireSuperuserAuth())

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

// ── Helpers ───────────────────────────────────────────────────────────────

func randomHex(bytes int) string {
	b := make([]byte, bytes)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func fillPrintable(b []byte) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	for i := range b {
		b[i] = alphabet[i%len(alphabet)]
	}
}
