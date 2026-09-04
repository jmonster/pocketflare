package d1

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestDeleteRecordRelations(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	core.RecordDeleteHook = DeleteRecord
	defer func() { core.RecordDeleteHook = nil }()

	save := func(model core.Model) {
		t.Helper()
		if err := app.SaveNoValidate(model); err != nil {
			t.Fatal(err)
		}
	}
	root := core.NewBaseCollection("pf_roots")
	save(root)
	child := core.NewBaseCollection("pf_children")
	child.Fields.Add(&core.RelationField{Name: "parent", CollectionId: root.Id, MaxSelect: 10, CascadeDelete: true})
	save(child)
	leaf := core.NewBaseCollection("pf_leaves")
	leaf.Fields.Add(&core.RelationField{Name: "parent", CollectionId: child.Id, MaxSelect: 1, CascadeDelete: true})
	save(leaf)
	optional := core.NewBaseCollection("pf_optional")
	optional.Fields.Add(&core.RelationField{Name: "parent", CollectionId: root.Id, MaxSelect: 10})
	save(optional)
	record := func(col *core.Collection, id string, parents ...string) *core.Record {
		r := core.NewRecord(col)
		r.Id = id
		r.Set("parent", parents)
		save(r)
		return r
	}
	a := record(root, "a")
	record(root, "b")
	// Repeated IDs in different collections must not collapse the cascade graph.
	record(child, "a", "a")
	record(leaf, "a", "a")
	record(child, "keep", "a", "b")
	record(leaf, "keep", "keep")
	record(optional, "keep", "a", "b")
	if err := app.Delete(a); err != nil {
		t.Fatal(err)
	}
	for _, col := range []*core.Collection{root, child, leaf} {
		if _, err := app.FindRecordById(col, "a"); err == nil {
			t.Fatalf("%s/a survived cascade", col.Name)
		}
	}
	for _, col := range []*core.Collection{child, optional} {
		r, err := app.FindRecordById(col, "keep")
		if err != nil {
			t.Fatal(err)
		}
		if ids := r.GetStringSlice("parent"); len(ids) != 1 || ids[0] != "b" {
			t.Fatalf("unexpected remaining references: %v", ids)
		}
	}
	if _, err := app.FindRecordById(leaf, "keep"); err != nil {
		t.Fatal("multi-relation cascaded despite a surviving parent", err)
	}

	// Required references reject the complete operation before any persistence.
	required := core.NewBaseCollection("pf_required")
	required.Fields.Add(&core.RelationField{Name: "parent", CollectionId: root.Id, Required: true, MaxSelect: 1})
	save(required)
	record(required, "required", "b")
	b, _ := app.FindRecordById(root, "b")
	if err := app.Delete(b); err == nil {
		t.Fatal("required reference did not block deletion")
	}
	if _, err := app.FindRecordById(root, "b"); err != nil {
		t.Fatal("blocked deletion persisted", err)
	}

	// A cyclic cascade terminates, and hook failures roll back the entire graph.
	cycle := core.NewBaseCollection("pf_cycle")
	cycle.Fields.Add(&core.RelationField{Name: "parent", CollectionId: cycle.Id, MaxSelect: 1, CascadeDelete: true})
	save(cycle)
	x := record(cycle, "x", "y")
	record(cycle, "y", "x")
	hook := app.OnRecordDelete(cycle.Id).BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Id == "y" {
			return errors.New("test rejection")
		}
		return e.Next()
	})
	if err := app.Delete(x); err == nil {
		t.Fatal("delete hook rejection was ignored")
	}
	if _, err := app.FindRecordById(cycle, "x"); err != nil {
		t.Fatal("failed cascade was not rolled back", err)
	}
	app.OnRecordDelete(cycle.Id).Unbind(hook)
	if err := app.Delete(x); err != nil {
		t.Fatal(err)
	}
	if count, err := app.CountRecords(cycle); err != nil || count != 0 {
		t.Fatalf("cycle survived: %d, %v", count, err)
	}
}

func TestDeleteRecordMoreThanOnePage(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	core.RecordDeleteHook = DeleteRecord
	defer func() { core.RecordDeleteHook = nil }()
	col := core.NewBaseCollection("pf_paged")
	col.Fields.Add(&core.RelationField{Name: "parent", CollectionId: col.Id, MaxSelect: 1, CascadeDelete: true})
	if err := app.SaveNoValidate(col); err != nil {
		t.Fatal(err)
	}
	_, err = app.DB().NewQuery(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<4001)
		INSERT INTO pf_paged(id,parent) SELECT printf('%015d',n), CASE WHEN n=0 THEN '' ELSE '000000000000000' END FROM seq`).Execute()
	if err != nil {
		t.Fatal(err)
	}
	root, err := app.FindRecordById(col, "000000000000000")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(root); err != nil {
		t.Fatal(err)
	}
	if count, err := app.CountRecords(col); err != nil || count != 0 {
		t.Fatalf("paged cascade left %d records: %v", count, err)
	}
}
