package adapter

import (
	"database/sql"
	"errors"
	"net/url"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func installerRedirectURL(app core.App, requestURL string) (string, error) {
	superuser, needed, err := ensureInstallerSuperuser(app)
	if err != nil || !needed {
		return "", err
	}

	token, err := superuser.NewStaticAuthToken(30 * time.Minute)
	if err != nil {
		return "", err
	}

	u, err := url.Parse(requestURL)
	if err != nil {
		return "", err
	}
	u.Path = "/_/"
	u.RawQuery = ""
	u.Fragment = "/pbinstall/" + token

	return u.String(), nil
}

func ensureInstallerSuperuser(app core.App) (*core.Record, bool, error) {
	total, err := app.CountRecords(core.CollectionNameSuperusers, dbx.Not(dbx.HashExp{
		"email": core.DefaultInstallerEmail,
	}))
	if err != nil || total > 0 {
		return nil, false, err
	}

	col, err := app.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return nil, false, err
	}

	record, err := app.FindAuthRecordByEmail(col, core.DefaultInstallerEmail)
	if err == nil {
		return record, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	record = core.NewRecord(col)
	record.SetEmail(core.DefaultInstallerEmail)
	record.SetRandomPassword()

	if err := app.Save(record); err != nil {
		return nil, false, err
	}

	return record, true, nil
}
