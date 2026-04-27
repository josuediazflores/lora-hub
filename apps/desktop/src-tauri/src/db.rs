//! SQLite persistence for chats, messages, and a generic key/value store.
//!
//! The database lives at `{app_data_dir}/lorahub.db` next to `audit.log`. We
//! use a small r2d2 connection pool so Tauri commands can grab a connection
//! without serializing on a single mutex; WAL mode is enabled so concurrent
//! readers don't block the writer.
//!
//! Schema migrations are tracked in a one-row `schema_version` table. Each
//! migration is applied in a transaction; if a migration fails, the DB is
//! left at the previous version. Migrations are idempotent because we only
//! apply ones whose version is strictly greater than the stored one.
//!
//! Errors are stringified with `.map_err(|e| e.to_string())` to match the
//! pattern used by `workspace.rs` and the rest of the Tauri commands.
//!
//! This module deliberately exposes no Tauri commands; those live in
//! `lib.rs` and accept `State<'_, Database>` to access the pool.

use std::path::Path;

use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

/// Bundled migration files. Each entry is `(version, sql)` and must be in
/// strictly increasing version order. To add a new migration, drop a file
/// in `src-tauri/migrations/` and append it here.
const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../migrations/001_initial.sql"))];

/// Pool-backed SQLite handle. Cheap to clone is not required — we store this
/// in Tauri-managed state and hand out `&State<'_, Database>` to commands,
/// which then call `pool.get()` to borrow a connection for the duration of
/// the request.
pub struct Database {
    pub pool: r2d2::Pool<SqliteConnectionManager>,
}

/// Open (or create) `lorahub.db` inside `app_data_dir`, enable WAL, and run
/// any pending migrations. Returns the wrapped pool ready for `app.manage`.
pub fn open(app_data_dir: &Path) -> Result<Database, String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("lorahub.db");

    // Foreign keys must be enabled per-connection; enforce via an init hook
    // so every pooled connection gets the same setup. WAL is a database-wide
    // setting (persisted in the file header), so we set it once on the
    // bootstrap connection below.
    let manager = SqliteConnectionManager::file(&db_path).with_init(|c| {
        c.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(())
    });
    let pool = r2d2::Pool::builder()
        .build(manager)
        .map_err(|e| e.to_string())?;

    let mut conn = pool.get().map_err(|e| e.to_string())?;
    // Switch to WAL once; the result is "wal" on success. Running this on an
    // already-WAL database is a no-op, so it's safe to call on every startup.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    migrate(&mut conn)?;
    drop(conn);

    Ok(Database { pool })
}

/// Apply any migrations whose version exceeds the recorded `schema_version`.
/// Idempotent: re-running with no new migrations is a no-op.
fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
    )
    .map_err(|e| e.to_string())?;

    let current: i64 = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    for (version, sql) in MIGRATIONS {
        if *version <= current {
            continue;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| e.to_string())?;
        // Rewrite the single-row schema_version table to the new version.
        tx.execute("DELETE FROM schema_version", [])
            .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_creates_db_and_runs_migrations() {
        let dir = tempdir().unwrap();
        let db = open(dir.path()).expect("open");
        let conn = db.pool.get().unwrap();

        // schema_version row exists and matches the latest bundled migration.
        let v: i64 = conn
            .query_row("SELECT version FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.last().unwrap().0);

        // Tables from 001_initial exist.
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name IN ('chats', 'messages', 'kv')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 3);
    }

    #[test]
    fn open_is_idempotent() {
        let dir = tempdir().unwrap();
        let _ = open(dir.path()).expect("first open");
        let _ = open(dir.path()).expect("second open");
        // No panic / no error means migrations didn't re-run destructively.
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let dir = tempdir().unwrap();
        let db = open(dir.path()).unwrap();
        let conn = db.pool.get().unwrap();
        let err = conn.execute(
            "INSERT INTO messages (id, chat_id, position, role, payload_json, created_at) \
             VALUES ('m1', 'no-such-chat', 0, 'user', '{}', 0)",
            [],
        );
        assert!(err.is_err(), "expected FK violation, got {err:?}");
    }
}
