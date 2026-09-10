'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildGraph } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-routes-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function routesOf(graph) {
  return graph.nodes.filter((n) => n.kind === 'route').map((n) => n.name).sort();
}

describe('extract routes (Flask / FastAPI / Express)', () => {
  it('Flask Blueprint url_prefix + get/post 合成完整路径', () => {
    const dir = makeRepo({
      'app/routes/todos.py': [
        'from flask import Blueprint, jsonify',
        'from app.services.todo_service import list_todos, create_todo',
        '',
        'todos_bp = Blueprint("todos", __name__, url_prefix="/todos")',
        '',
        '@todos_bp.get("")',
        'def get_todos():',
        '    return jsonify([t.to_dict() for t in list_todos()])',
        '',
        '@todos_bp.post("")',
        'def add_todo():',
        '    return jsonify(create_todo(title="x").to_dict()), 201',
        '',
        '@todos_bp.get("/stats")',
        'def stats():',
        '    return jsonify({})',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const names = routesOf(g);
      assert.ok(names.includes('GET /todos'), names.join(','));
      assert.ok(names.includes('POST /todos'), names.join(','));
      assert.ok(names.includes('GET /todos/stats'), names.join(','));
      const stats = g.nodes.find((n) => n.name === 'GET /todos/stats');
      const handles = g.edges.filter((e) => e.type === 'handles' && e.to === stats.id);
      assert.equal(handles.length, 1);
      assert.equal(handles[0].from, 'app/routes/todos#stats');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FastAPI APIRouter(prefix) + @router.get', () => {
    const dir = makeRepo({
      'api/items.py': [
        'from fastapi import APIRouter',
        'router = APIRouter(prefix="/items")',
        '',
        '@router.get("/{item_id}")',
        'def read_item(item_id: str):',
        '    return {"id": item_id}',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      assert.ok(routesOf(g).includes('GET /items/{item_id}'), routesOf(g).join(','));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Flask @app.route methods= 拆成多条', () => {
    const dir = makeRepo({
      'app.py': [
        'from flask import Flask',
        'app = Flask(__name__)',
        '',
        '@app.route("/health", methods=["GET", "HEAD"])',
        'def health():',
        '    return "ok"',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const names = routesOf(g);
      assert.ok(names.includes('GET /health'), names.join(','));
      assert.ok(names.includes('HEAD /health'), names.join(','));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Express app.get / router.post 字面量路径', () => {
    const dir = makeRepo({
      'src/routes.js': [
        'const express = require("express");',
        'const { listTodos } = require("./svc");',
        'const router = express.Router();',
        'function addTodo(req, res) { res.end("ok"); }',
        'router.get("/todos", listTodos);',
        'router.post("/todos", addTodo);',
        'module.exports = { router };',
        ''
      ].join('\n'),
      'src/svc.js': 'function listTodos(req, res) { res.end("[]"); }\nmodule.exports = { listTodos };\n'
    });
    try {
      const g = buildGraph(dir);
      const names = routesOf(g);
      assert.ok(names.includes('GET /todos'), names.join(','));
      assert.ok(names.includes('POST /todos'), names.join(','));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Map.get("/x") 不抽成路由', () => {
    const dir = makeRepo({
      'src/cache.js': [
        'const map = new Map();',
        'function read() { return map.get("/todos"); }',
        'module.exports = { read };',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      assert.deepEqual(routesOf(g), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('动态路径不抽（避免假路由）', () => {
    const dir = makeRepo({
      'app.py': [
        'from flask import Flask',
        'app = Flask(__name__)',
        'p = "/dyn"',
        '@app.get(p)',
        'def dyn():',
        '    return "x"',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      assert.deepEqual(routesOf(g), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
