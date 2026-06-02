package adapter

import (
	"context"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

type doctorResponse struct {
	DBMode  string         `json:"dbMode"`
	DB      doctorDBCheck  `json:"db"`
	AuxDB   doctorDBCheck  `json:"auxDb"`
	Storage r2BindingCheck `json:"storage"`
	Backups r2BindingCheck `json:"backups"`
}

type doctorDBCheck struct {
	OK      bool   `json:"ok"`
	Latency string `json:"latency"`
	Error   string `json:"error,omitempty"`
}

func registerDoctorRoute(app core.App, rg *router.RouterGroup[*core.RequestEvent], dbMode string) {
	rg.GET("/doctor", func(e *core.RequestEvent) error {
		resp := doctorResponse{DBMode: dbMode}

		// Main DB health check.
		start := time.Now()
		var v int
		err := app.NonconcurrentDB().NewQuery("SELECT 1").WithContext(context.Background()).Row(&v)
		resp.DB.OK = err == nil && v == 1
		resp.DB.Latency = time.Since(start).Truncate(time.Millisecond).String()
		if err != nil {
			resp.DB.Error = err.Error()
		}

		// Aux DB health check.
		start = time.Now()
		err = app.AuxNonconcurrentDB().NewQuery("SELECT 1").WithContext(context.Background()).Row(&v)
		resp.AuxDB.OK = err == nil && v == 1
		resp.AuxDB.Latency = time.Since(start).Truncate(time.Millisecond).String()
		if err != nil {
			resp.AuxDB.Error = err.Error()
		}

		// R2 binding checks: list one object from each bucket.
		resp.Storage = checkR2Binding("STORAGE")
		resp.Backups = checkR2Binding("BACKUPS")

		status := http.StatusOK
		if !resp.DB.OK || !resp.AuxDB.OK {
			status = http.StatusServiceUnavailable
		}
		return e.JSON(status, resp)
	}).Bind(apis.RequireSuperuserAuth())
}
