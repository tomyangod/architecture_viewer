"""storage 层：sqlite3 持久化，唯一允许碰数据库的地方。"""
import sqlite3

DB_PATH = "todos.db"


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS todos ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "title TEXT NOT NULL, "
            "done INTEGER NOT NULL DEFAULT 0)"
        )


def select_all_todos():
    with _conn() as conn:
        return conn.execute("SELECT id, title, done FROM todos").fetchall()


def insert_todo(title):
    with _conn() as conn:
        cur = conn.execute("INSERT INTO todos (title) VALUES (?)", (title,))
        row = conn.execute(
            "SELECT id, title, done FROM todos WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return row


def update_done(todo_id, done):
    with _conn() as conn:
        conn.execute("UPDATE todos SET done = ? WHERE id = ?", (1 if done else 0, todo_id))
        return conn.execute(
            "SELECT id, title, done FROM todos WHERE id = ?", (todo_id,)
        ).fetchone()


def delete_completed():
    with _conn() as conn:
        cur = conn.execute("DELETE FROM todos WHERE done = 1")
        return cur.rowcount


def count_todos():
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total, SUM(done) AS done FROM todos"
        ).fetchone()
        return {"total": row["total"], "done": row["done"] or 0}
