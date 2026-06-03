package adapter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

var ErrRestoreMarkerExists = errors.New("restore marker already exists")

// RestoreMarker is the durable restore session state stored in R2.
type RestoreMarker struct {
	SessionID       string              `json:"sessionId"`
	StartedAt       time.Time           `json:"startedAt"`
	Phase           string              `json:"phase"` // "database" | "files"
	DBProgress      RestoreDBProgress   `json:"dbProgress"`
	FileProgress    RestoreFileProgress `json:"fileProgress"`
	FileUploadToken string              `json:"fileUploadToken"`
}

type RestoreDBProgress struct {
	BatchesDone  int `json:"batchesDone"`
	BatchesTotal int `json:"batchesTotal"`
	RowsImported int `json:"rowsImported"`
}

type RestoreFileProgress struct {
	FilesDone     int   `json:"filesDone"`
	FilesTotal    int   `json:"filesTotal"`
	BytesUploaded int64 `json:"bytesUploaded"`
}

// registerPocketflareRestoreRoutes adds Pocketflare restore endpoints under /api/pocketflare/restore.
func registerPocketflareRestoreRoutes(app core.App, rg *router.RouterGroup[*core.RequestEvent], dbMode string) {
	sub := rg.Group("/pocketflare/restore")
	sub.GET("/status", restoreStatus(dbMode)).Bind(apis.RequireSuperuserAuth())
	sub.GET("/session", restoreSessionStatus).Unbind(
		apis.DefaultRequireAuthMiddlewareId,
		apis.DefaultRequireSuperuserAuthMiddlewareId,
		apis.DefaultRequireSuperuserOrOwnerAuthMiddlewareId,
		apis.DefaultRequireSameCollectionContextAuthMiddlewareId,
	)
	sub.POST("/start", restoreStart(dbMode)).Bind(apis.RequireSuperuserAuth())
	// Restore-session routes must not inherit PocketBase auth middleware once the
	// system auth tables have been cleared by the restore.
	sub.POST("/database", restoreDatabase(dbMode)).Unbind(
		apis.DefaultRequireAuthMiddlewareId,
		apis.DefaultRequireSuperuserAuthMiddlewareId,
		apis.DefaultRequireSuperuserOrOwnerAuthMiddlewareId,
		apis.DefaultRequireSameCollectionContextAuthMiddlewareId,
	)
	sub.POST("/phase", restorePhase).Unbind(
		apis.DefaultRequireAuthMiddlewareId,
		apis.DefaultRequireSuperuserAuthMiddlewareId,
		apis.DefaultRequireSuperuserOrOwnerAuthMiddlewareId,
		apis.DefaultRequireSameCollectionContextAuthMiddlewareId,
	)
	sub.POST("/cancel", restoreCancel).Unbind(
		apis.DefaultRequireAuthMiddlewareId,
		apis.DefaultRequireSuperuserAuthMiddlewareId,
		apis.DefaultRequireSuperuserOrOwnerAuthMiddlewareId,
		apis.DefaultRequireSameCollectionContextAuthMiddlewareId,
	)
	sub.POST("/finalize", restoreFinalize(dbMode)).Unbind(
		apis.DefaultRequireAuthMiddlewareId,
		apis.DefaultRequireSuperuserAuthMiddlewareId,
		apis.DefaultRequireSuperuserOrOwnerAuthMiddlewareId,
		apis.DefaultRequireSameCollectionContextAuthMiddlewareId,
	)
}

// ── GET /api/pocketflare/restore/status ──────────────────────────────────

type restoreStatusResponse struct {
	DBMode          string         `json:"dbMode"`
	Empty           bool           `json:"empty"`
	BlockingReasons []string       `json:"blockingReasons"`
	ActiveRestore   *RestoreMarker `json:"activeRestore"`
}

func restoreStatus(dbMode string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		resp := restoreStatusResponse{DBMode: dbMode}

		active, _ := readRestoreMarker()
		if active != nil {
			resp.ActiveRestore = active
		}

		reasons := checkEmptyTarget(e.App)
		resp.Empty = len(reasons) == 0
		resp.BlockingReasons = reasons

		return e.JSON(http.StatusOK, resp)
	}
}

func checkEmptyTarget(app core.App) []string {
	var reasons []string

	collections, err := app.FindAllCollections()
	if err == nil {
		for _, c := range collections {
			if !c.System && c.Name != "users" {
				reasons = append(reasons, "non-system collection exists: "+c.Name)
			}
		}
		// Check if the users collection has real records.
		if _, err := app.FindCollectionByNameOrId("users"); err == nil {
			var count int
			if err := app.DB().NewQuery("SELECT COUNT(*) FROM [users]").Row(&count); err == nil && count > 0 {
				reasons = append(reasons, fmt.Sprintf("users collection contains %d record(s)", count))
			}
		}
	}

	if hasStorageObjects(app) {
		reasons = append(reasons, "R2 STORAGE bucket already contains objects under storage/ prefix")
	}

	return reasons
}

// ── POST /api/pocketflare/restore/start ──────────────────────────────────

type restoreStartResponse struct {
	SessionID       string `json:"sessionId"`
	FileUploadToken string `json:"fileUploadToken"`
}

func restoreStart(dbMode string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		reasons := checkEmptyTarget(e.App)
		if len(reasons) > 0 {
			return e.JSON(http.StatusConflict, map[string]any{
				"error":           "target is not empty",
				"blockingReasons": reasons,
			})
		}

		sessionID := randomHex(16)
		fileUploadToken := randomHex(32)

		marker := &RestoreMarker{
			SessionID:       sessionID,
			StartedAt:       time.Now().UTC(),
			Phase:           "database",
			FileUploadToken: fileUploadToken,
		}

		if err := writeRestoreMarkerOnlyIfNew(marker); err != nil {
			if err == ErrRestoreMarkerExists {
				existing, readErr := readRestoreMarker()
				if readErr == nil && existing != nil {
					return e.JSON(http.StatusConflict, map[string]any{
						"error":     "active restore session already exists",
						"sessionId": existing.SessionID,
						"phase":     existing.Phase,
						"progress":  existing,
					})
				}
			}
			return e.InternalServerError("failed to write restore marker", err)
		}

		return e.JSON(http.StatusOK, restoreStartResponse{
			SessionID:       sessionID,
			FileUploadToken: fileUploadToken,
		})
	}
}

// ── POST /api/pocketflare/restore/phase ──────────────────────────────────

func restorePhase(e *core.RequestEvent) error {
	body := struct {
		SessionID string `json:"sessionId"`
		Phase     string `json:"phase"`
	}{}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	if body.SessionID == "" {
		return e.BadRequestError("missing sessionId", nil)
	}
	if body.Phase != "files" {
		return e.BadRequestError("phase must be 'files'", nil)
	}

	marker, err := requireRestoreToken(e)
	if err != nil {
		return err
	}
	if marker.SessionID != body.SessionID {
		return e.BadRequestError("session mismatch", nil)
	}

	if marker.Phase != "database" {
		return e.BadRequestError("can only transition from database phase, current: "+marker.Phase, nil)
	}

	marker.Phase = body.Phase
	if err := writeRestoreMarker(marker); err != nil {
		return e.InternalServerError("failed to update restore phase", err)
	}

	return e.JSON(http.StatusOK, map[string]string{"phase": marker.Phase})
}

// ── POST /api/pocketflare/restore/cancel ─────────────────────────────────

func restoreCancel(e *core.RequestEvent) error {
	body := struct {
		SessionID string `json:"sessionId"`
	}{}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid request body", err)
	}

	marker, err := requireRestoreToken(e)
	if err != nil {
		return err
	}
	if marker.SessionID != body.SessionID {
		return e.BadRequestError("session mismatch", nil)
	}

	// Refuse cancel once any database batch has been executed. The marker is
	// written before each batch, so even if a subsequent marker write fails the
	// previous successful write records that progress was made.
	if marker.DBProgress.BatchesDone > 0 {
		return e.BadRequestError("database import already started; cannot cancel safely", nil)
	}
	// Must still be in database phase (before files).
	if marker.Phase != "database" {
		return e.BadRequestError("cannot cancel in phase: "+marker.Phase, nil)
	}

	if err := deleteRestoreMarker(); err != nil {
		return e.InternalServerError("failed to delete restore marker", err)
	}
	return e.JSON(http.StatusOK, map[string]bool{"ok": true})
}

// ── POST /api/pocketflare/restore/database ───────────────────────────────

type restoreDatabaseRequest struct {
	SessionID  string             `json:"sessionId"`
	DB         string             `json:"db"` // "app" or "logs"
	Statements []restoreStatement `json:"statements"`
}

type restoreStatement struct {
	SQL    string `json:"sql"`
	Params []any  `json:"params"`
}

type restoreDatabaseResponse struct {
	OK           bool `json:"ok"`
	Statements   int  `json:"statements"`
	RowsAffected int  `json:"rowsAffected"`
}

func restoreDatabase(dbMode string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		body := new(restoreDatabaseRequest)
		if err := e.BindBody(body); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if body.SessionID == "" {
			return e.BadRequestError("missing sessionId", nil)
		}
		if body.DB != "app" && body.DB != "logs" {
			return e.BadRequestError("db must be 'app' or 'logs'", nil)
		}

		marker, err := requireRestoreToken(e)
		if err != nil {
			return err
		}
		if marker.SessionID != body.SessionID {
			return e.BadRequestError("session mismatch", nil)
		}
		if marker.Phase != "database" {
			return e.BadRequestError("restore is not in database phase", nil)
		}

		if len(body.Statements) == 0 {
			return e.JSON(http.StatusOK, restoreDatabaseResponse{OK: true})
		}

		return executeRestoreStatements(e, body, dbMode, marker)
	}
}

func executeRestoreStatements(e *core.RequestEvent, body *restoreDatabaseRequest, dbMode string, marker *RestoreMarker) error {
	// Write the incremented progress before executing, so even if the
	// marker write after execution fails, a previous successful write
	// recorded that progress was made. This blocks unsafe /cancel.
	marker.DBProgress.BatchesDone++
	if err := writeRestoreMarker(marker); err != nil {
		e.App.Logger().Error(
			"restore: failed to write progress marker before batch",
			"sessionId", marker.SessionID,
			"phase", marker.Phase,
			"db", body.DB,
			"batchesDone", marker.DBProgress.BatchesDone,
			"error", err.Error(),
		)
		return e.InternalServerError("failed to write progress marker before batch", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	var rowsAffected int

	execBatch := func(txApp core.App, getDB func(core.App) dbx.Builder) error {
		for _, stmt := range body.Statements {
			sql, bindParams, err := restoreBindParams(stmt.SQL, stmt.Params)
			if err != nil {
				return fmt.Errorf("param binding: %w", err)
			}
			q := getDB(txApp).NewQuery(sql).WithContext(ctx)
			if len(bindParams) > 0 {
				q = q.Bind(bindParams)
			}
			execResult, execErr := q.Execute()
			if execErr != nil {
				return execErr
			}
			n, _ := execResult.RowsAffected()
			rowsAffected += int(n)
		}
		return nil
	}

	if dbMode == "do_sqlite" {
		txErr := e.App.RunInTransaction(func(txApp core.App) error {
			return execBatch(txApp, func(a core.App) dbx.Builder { return a.NonconcurrentDB() })
		})
		if txErr != nil {
return e.BadRequestError("database import failed", txErr)
		}
	} else if body.DB == "logs" {
		txErr := e.App.AuxRunInTransaction(func(txApp core.App) error {
			return execBatch(txApp, func(a core.App) dbx.Builder { return a.AuxNonconcurrentDB() })
		})
		if txErr != nil {
			return e.BadRequestError("logs database import failed", txErr)
		}
	} else {
		txErr := e.App.RunInTransaction(func(txApp core.App) error {
			return execBatch(txApp, func(a core.App) dbx.Builder { return a.NonconcurrentDB() })
		})
		if txErr != nil {
return e.BadRequestError("database import failed", txErr)
		}
	}

	// Update row counts after successful execution.
	marker.DBProgress.RowsImported += rowsAffected
	if err := writeRestoreMarker(marker); err != nil {
		e.App.Logger().Warn("restore: failed to update row count in marker", "error", err.Error())
	}

	return e.JSON(http.StatusOK, restoreDatabaseResponse{
		OK:           true,
		Statements:   len(body.Statements),
		RowsAffected: rowsAffected,
	})
}

// ── POST /api/pocketflare/restore/finalize ───────────────────────────────

type restoreFinalizeResponse struct {
	OK   bool   `json:"ok"`
	Note string `json:"note"`
}

func restoreFinalize(dbMode string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		body := struct {
			SessionID string `json:"sessionId"`
		}{}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("invalid request body", err)
		}
		if body.SessionID == "" {
			return e.BadRequestError("missing sessionId", nil)
		}

		marker, err := requireRestoreToken(e)
		if err != nil {
			return err
		}
		if marker.SessionID != body.SessionID {
			return e.BadRequestError("session mismatch", nil)
		}
		if marker.Phase != "database" && marker.Phase != "files" {
			return e.BadRequestError("cannot finalize in phase: "+marker.Phase, nil)
		}

		// The running isolate must see the restored schema immediately.
		// Without these reloads, same-isolate requests keep serving the
		// pre-restore collection/auth cache until a cold start.
		if err := e.App.ReloadSettings(); err != nil {
			return e.InternalServerError("failed to reload settings after restore", err)
		}
		if err := e.App.ReloadCachedCollections(); err != nil {
			return e.InternalServerError("failed to reload collections after restore", err)
		}
		if err := deleteRestoreMarker(); err != nil {
			return e.InternalServerError("failed to delete restore marker after finalize", err)
		}

		return e.JSON(http.StatusOK, restoreFinalizeResponse{
			OK:   true,
			Note: "Current session may be invalid. Log in with restored superuser credentials.",
		})
	}
}

// ── GET /api/pocketflare/restore/session ─────────────────────────────────

func restoreSessionStatus(e *core.RequestEvent) error {
	marker, err := requireRestoreToken(e)
	if err != nil {
		return err
	}
	return e.JSON(http.StatusOK, map[string]any{
		"sessionId":       marker.SessionID,
		"phase":           marker.Phase,
		"startedAt":       marker.StartedAt,
		"dbProgress":      marker.DBProgress,
		"fileProgress":    marker.FileProgress,
		"fileUploadToken": marker.FileUploadToken,
	})
}

func requireRestoreToken(e *core.RequestEvent) (*RestoreMarker, error) {
	marker, err := readRestoreMarker()
	if err != nil {
		return nil, e.InternalServerError("failed to read restore marker", err)
	}
	if marker == nil {
		return nil, e.BadRequestError("no active restore session", nil)
	}

	token := e.Request.Header.Get("X-Pocketflare-Restore-Token")
	if token == "" || token != marker.FileUploadToken {
		return nil, e.UnauthorizedError("The request requires a valid restore session token.", nil)
	}

	return marker, nil
}

// ── Param binding ────────────────────────────────────────────────────────

// restoreBindParams converts positional ? placeholders to dbx named
// placeholders ({:p0}, {:p1}, ...) and returns the corresponding Params map.
// JSON []any values (from Uint8Array serialization) are converted to []byte
// so the D1 driver can bind them as blobs.
func restoreBindParams(sql string, params []any) (string, dbx.Params, error) {
	if len(params) == 0 {
		return sql, nil, nil
	}

	placeholderCount := strings.Count(sql, "?")
	if placeholderCount != len(params) {
		return "", nil, fmt.Errorf("placeholder/param count mismatch: %d placeholders, %d params", placeholderCount, len(params))
	}

	dbParams := make(dbx.Params, len(params))
	var buf strings.Builder
	buf.Grow(len(sql) + len(params)*6)

	paramIdx := 0
	for i := 0; i < len(sql); i++ {
		if sql[i] == '?' && paramIdx < len(params) {
			name := fmt.Sprintf("p%d", paramIdx)
			buf.WriteString("{:" + name + "}")
			dbParams[name] = coerceParam(params[paramIdx])
			paramIdx++
		} else {
			buf.WriteByte(sql[i])
		}
	}

	return buf.String(), dbParams, nil
}

// coerceParam converts JSON-deserialized values into Go types the D1/DO
// SQLite driver can bind. Specifically, []any (from Uint8Array→JSON array)
// is converted to []byte for blob columns.
func coerceParam(v any) any {
	if arr, ok := v.([]any); ok {
		b := make([]byte, len(arr))
		for i, val := range arr {
			if n, ok := val.(float64); ok {
				b[i] = byte(n)
			}
		}
		return b
	}
	return v
}

// ── Helpers ──────────────────────────────────────────────────────────────

func randomHex(bytes int) string {
	b := make([]byte, bytes)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func markerToJSON(marker *RestoreMarker) []byte {
	data, _ := json.Marshal(marker)
	return data
}

func parseMarkerJSON(data []byte) (*RestoreMarker, error) {
	var marker RestoreMarker
	if err := json.Unmarshal(data, &marker); err != nil {
		return nil, err
	}
	return &marker, nil
}
