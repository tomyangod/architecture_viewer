"""待办清单 API —— Flask 入口。"""
from flask import Flask

from app.routes.todos import todos_bp


def create_app():
    app = Flask(__name__)
    app.register_blueprint(todos_bp)
    return app


if __name__ == "__main__":
    create_app().run(debug=True)
