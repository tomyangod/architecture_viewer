"""service 层：业务逻辑，routes 与 database 之间的中间人。"""
from app.database.todo_repo import (
    count_todos,
    delete_completed,
    insert_todo,
    select_all_todos,
    update_done,
)
from app.models.todo import Todo


def list_todos():
    rows = select_all_todos()
    return [Todo.from_row(row) for row in rows]


def create_todo(title):
    if not title or not title.strip():
        raise ValueError("title 不能为空")
    return insert_todo(title=title.strip())


def complete_todo(todo_id):
    row = update_done(todo_id, done=True)
    if row is None:
        raise LookupError(f"todo {todo_id} 不存在")
    return Todo.from_row(row)


def clear_completed():
    return delete_completed()


def todo_stats():
    stats = count_todos()
    stats["open"] = stats["total"] - stats["done"]
    return stats

