// System tables keep their bootstrapped schema. User schema belongs to its
// source database; SQL LIKE '_%' would match every nonempty table name.
export function getUserSchemaObjects(dataDB, auxDB) {
    const objects = [];
    for (const [target, db] of [["app", dataDB], ["aux", auxDB]]) {
        if (!db) continue;
        const rows = db.exec(
            "SELECT type, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('index','view','trigger') AND tbl_name NOT GLOB '_*' AND tbl_name NOT GLOB 'sqlite_*' ORDER BY rowid",
        )[0]?.values || [];
        for (const [type, tableName, sql] of rows) {
            const ddl = type === "index"
                ? sql.trim().replace(/^CREATE (UNIQUE )?INDEX\s+(?!IF NOT EXISTS)/i, "CREATE $1INDEX IF NOT EXISTS ")
                : sql.trim();
            objects.push({ db: target, type, tableName, sql: ddl });
        }
    }
    return objects;
}
