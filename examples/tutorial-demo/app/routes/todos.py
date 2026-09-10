"""controller 层：接收 HTTP 请求，不碰数据库。"""
from flask import Blueprint, jsonify, request

from app.services.todo_service import (
    clear_completed,
    complete_todo,
    create_todo,
    list_todos,
    todo_stats,
)


todos_bp = Blueprint("todos", __name__, url_prefix="/todos")


@todos_bp.get("")
def get_todos():
    return jsonify([t.to_dict() for t in list_todos()])


@todos_bp.post("")
def add_todo():
    data = request.get_json(force=True)
    todo = create_todo(title=data["title"])
    return jsonify(todo.to_dict()), 201


@todos_bp.patch("/<int:todo_id>/done")
def mark_done(todo_id):
    todo = complete_todo(todo_id)
    return jsonify(todo.to_dict())


@todos_bp.delete("/completed")
def clear_done():
    removed = clear_completed()
    return jsonify({"cleared": removed})


@todos_bp.get("/stats")
def stats():
    return jsonify(todo_stats())
