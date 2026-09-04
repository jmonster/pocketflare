import assert from "node:assert/strict";
import { test } from "node:test";
import initSqlJs from "sql.js";
import { getUserSchemaObjects } from "../lib/restore-schema.mjs";

test("restore preserves user indexes, views and triggers in their source database", async () => {
  const SQL = await initSqlJs();
  const app = new SQL.Database();
  const aux = new SQL.Database();
  const restored = { app: new SQL.Database(), aux: new SQL.Database() };
  try {
    const table = "CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT)";
    app.run(`${table};
      CREATE UNIQUE INDEX unique_value ON items(value);
      CREATE VIEW item_view AS SELECT * FROM items;
      CREATE TRIGGER insert_value AFTER INSERT ON items BEGIN UPDATE items SET value=upper(value) WHERE id=new.id; END;
      CREATE TABLE _system(value TEXT);
      CREATE INDEX system_value ON _system(value)`);
    aux.run(`${table}; CREATE INDEX aux_value ON items(value)`);
    const objects = getUserSchemaObjects(app, aux);
    assert.deepEqual(objects.map((o) => [o.db, o.type]), [
      ["app", "index"], ["app", "view"], ["app", "trigger"], ["aux", "index"],
    ]);
    for (const target of Object.values(restored)) target.run(table);
    for (const object of objects) restored[object.db].run(object.sql);
    restored.app.run("INSERT INTO items(value) VALUES('value')");
    assert.equal(restored.app.exec("SELECT value FROM item_view")[0].values[0][0], "VALUE");
    assert.throws(() => restored.app.run("INSERT INTO items(value) VALUES('VALUE')"), /UNIQUE/);
    assert.equal(restored.aux.exec("SELECT name FROM sqlite_master WHERE name='aux_value'")[0].values[0][0], "aux_value");
  } finally {
    for (const db of [app, aux, ...Object.values(restored)]) db.close();
  }
});
