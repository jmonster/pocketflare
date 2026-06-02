//go:build js && wasm

package adapter

import (
	"bytes"
	"fmt"
	"io"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/syumai/workers/cloudflare"
)

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

func registerProofCopyRoute(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {
	rg.POST("/proof/copy", func(e *core.RequestEvent) error {
		body := new(proofCopyRequest)
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

		// Determine which copy path will be used.
		copyPath := "streaming-fallback"
		if cloudflare.Getenv("R2_ACCESS_KEY_ID") != "" &&
			cloudflare.Getenv("R2_SECRET_ACCESS_KEY") != "" &&
			cloudflare.Getenv("R2_ACCOUNT_ID") != "" {
			copyPath = "s3-copy-object"
		}

		fsys, err := app.NewFilesystem()
		if err != nil {
			return e.InternalServerError("failed to create filesystem", err)
		}
		defer fsys.Close()

		// Generate source content with a recognizable prefix plus random fill.
		prefix := fmt.Sprintf("proof-copy-src-%s-", randomHex(8))
		content := make([]byte, body.Size)
		copy(content, prefix)
		randFill(content[len(prefix):])

		suffix := randomHex(6)
		srcKey := "proof-copy/src-" + suffix
		dstKey := "proof-copy/dst-" + suffix

		// Clean up regardless of outcome.
		defer func() {
			_ = fsys.Delete(srcKey)
			_ = fsys.Delete(dstKey)
		}()

		// Upload source object.
		if err := fsys.Upload(content, srcKey); err != nil {
			return e.InternalServerError("upload source failed", err)
		}

		// Copy src -> dst through the filesystem (triggers R2 Copy path).
		if err := fsys.Copy(srcKey, dstKey); err != nil {
			return e.InternalServerError("copy failed", err)
		}

		// Verify source still exists.
		srcAttrs, srcErr := fsys.Attributes(srcKey)
		srcExists := srcErr == nil

		// Verify destination exists and matches.
		dstAttrs, dstErr := fsys.Attributes(dstKey)
		dstExists := dstErr == nil

		contentTypeMatch := false
		if srcExists && dstExists {
			contentTypeMatch = srcAttrs.ContentType == dstAttrs.ContentType
		}

		// Read back destination bytes and compare with source content.
		bytesMatch := false
		if dstExists {
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

		status := http.StatusOK
		if !resp.OK {
			status = http.StatusInternalServerError
		}
		return e.JSON(status, resp)
	}).Bind(apis.RequireSuperuserAuth())
}

func randFill(b []byte) {
	// Fill with printable ASCII to keep content-type detection stable.
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	for i := range b {
		b[i] = alphabet[i%len(alphabet)]
	}
}
