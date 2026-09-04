package d1

import "testing"

func TestSQLStatements(t *testing.T) {
	for _, tc := range []struct {
		query     string
		count     int
		wantError bool
	}{
		{`insert into t values ('a;''b', X'3B'); /* ; */ update t set value='c;d';`, 2, false},
		{"select ';' as `semi;colon`, 1 as [other;column]; -- ;\nselect 2;", 2, false},
		{`CREATE TRIGGER t AFTER INSERT ON items BEGIN UPDATE items SET n=CASE WHEN n>1 THEN 2 ELSE 0 END; DELETE FROM old; END; INSERT INTO items VALUES(1);`, 2, false},
		{"select 1; -- comment\ninsert into t values(1)", 0, true},
		{`WITH x AS (SELECT 1) SELECT * FROM x; INSERT INTO t VALUES(1);`, 0, true},
		{`WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x; INSERT INTO t VALUES(2);`, 2, false},
		{`insert into t values ('broken);`, 0, true},
		{`select 1; /* unfinished`, 0, true},
	} {
		statements, _, err := PrepareSQLQuery(tc.query)
		if (err != nil) != tc.wantError || len(statements) != tc.count {
			t.Errorf("%q: got %v, %v", tc.query, statements, err)
		}
	}
}
