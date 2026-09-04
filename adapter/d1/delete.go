// Package d1 implements adaptations for D1's deferred write transactions.
package d1

import (
	"context"
	"fmt"
	"slices"
	"sort"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/dbutils"
	"github.com/pocketbase/pocketbase/tools/inflector"
)

type deletePlanKey struct{}

// DeleteRecord resolves the whole relation graph before queuing any writes.
// Every affected record still goes through PocketBase's field and model hooks.
func DeleteRecord(e *core.RecordEvent) error {
	if planned, _ := e.Context.Value(deletePlanKey{}).(map[*core.Record]bool); planned[e.Record] {
		return e.Next()
	}

	key := func(r *core.Record) string { return r.Collection().Id + "/" + r.Id }
	queue := []*core.Record{e.Record}
	deleted := map[string]bool{key(e.Record): true}
	records := map[string]*core.Record{key(e.Record): e.Record}
	var changed []*core.Record
	changedKeys := map[string]bool{}
	requiredEmpty := map[string]bool{}

	for i := 0; i < len(queue); i++ {
		target := queue[i]
		refs, err := e.App.FindCachedCollectionReferences(target.Collection())
		if err != nil {
			return err
		}
		collections := make([]*core.Collection, 0, len(refs))
		for collection := range refs {
			collections = append(collections, collection)
		}
		sort.Slice(collections, func(i, j int) bool { return collections[i].Name < collections[j].Name })
		for _, collection := range collections {
			if collection.IsView() {
				continue
			}
			for _, field := range refs[collection] {
				relation, ok := field.(*core.RelationField)
				if !ok {
					return fmt.Errorf("unsupported reference field type %s", field.Type())
				}
				name := inflector.Columnify(collection.Name) + "." + inflector.Columnify(field.GetName())
				query := e.App.RecordQuery(collection)
				if relation.IsMultiple() {
					query.AndWhere(dbx.Exists(dbx.NewExp(
						"SELECT 1 FROM "+dbutils.JSONEach(name)+" {{__je__}} WHERE [[__je__.value]]={:id}",
						dbx.Params{"id": target.Id},
					)))
				} else {
					query.AndWhere(dbx.HashExp{name: target.Id})
				}
				// No writes occur during traversal, so advance through a stable ordering.
				for offset := int64(0); ; offset += 4000 {
					var batch []*core.Record
					if err := query.OrderBy("id").Limit(4000).Offset(offset).All(&batch); err != nil {
						return err
					}
					for _, record := range batch {
						id := key(record)
						if deleted[id] {
							continue
						}
						if existing := records[id]; existing != nil {
							record = existing
						} else {
							records[id] = record
						}
						ids := slices.DeleteFunc(record.GetStringSlice(relation.Name), func(id string) bool { return id == target.Id })
						if relation.CascadeDelete && len(ids) == 0 {
							deleted[id] = true
							queue = append(queue, record)
						} else {
							record.Set(relation.Name, ids)
							if relation.Required && len(ids) == 0 {
								requiredEmpty[id] = true
							}
							if !changedKeys[id] {
								changedKeys[id] = true
								changed = append(changed, record)
							}
						}
					}
					if len(batch) < 4000 {
						break
					}
				}
			}
		}
	}

	for _, record := range changed {
		if requiredEmpty[key(record)] && !deleted[key(record)] {
			return fmt.Errorf("the record cannot be deleted because it is part of a required reference in record %s (%s collection)", record.Id, record.Collection().Name)
		}
	}
	originalApp := e.App
	defer func() { e.App = originalApp }()
	return originalApp.RunInTransaction(func(txApp core.App) error {
		e.App = txApp
		if err := e.Next(); err != nil {
			return err
		}
		for _, record := range changed {
			if !deleted[key(record)] {
				if err := txApp.SaveNoValidateWithContext(e.Context, record); err != nil {
					return err
				}
			}
		}
		planned := make(map[*core.Record]bool, len(queue))
		for _, record := range queue {
			planned[record] = true
		}
		ctx := context.WithValue(e.Context, deletePlanKey{}, planned)
		for _, record := range queue[1:] {
			if err := txApp.DeleteWithContext(ctx, record); err != nil {
				return err
			}
		}
		return nil
	})
}
