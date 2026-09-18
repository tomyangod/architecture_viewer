'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-enum-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function riskFrom(filesBefore, filesAfter, opts) {
  const dir = makeRepo(filesBefore);
  const base = buildGraph(dir, opts);
  for (const [rel, content] of Object.entries(filesAfter)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const head = buildGraph(dir, opts);
  const diff = diffGraphs(base, head);
  const findings = evaluateRisk(diff, head, base, null, {});
  return { dir, base, head, diff, findings };
}

describe('W21-01a R18 enum-exhaustiveness', () => {
  it('TS 枚举新增成员且 switch 无 default → MEDIUM reportOnly', () => {
    const { findings, head } = riskFrom({
      'src/status.ts': `
export enum Status { Open, Closed }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    case Status.Closed: return 'closed';
  }
}
`
    }, {
      'src/status.ts': `
export enum Status { Open, Closed, Pending }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    case Status.Closed: return 'closed';
  }
}
`
    });
    const enumNode = head.nodes.find((n) => n.kind === 'enum' && n.name === 'Status');
    assert.ok(enumNode, 'Status enum extracted');
    assert.ok((enumNode.enumValues || []).includes('Pending'), enumNode.enumValues);
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected enum-exhaustiveness, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.severity, 'medium');
    assert.equal(hit.reportOnly, true);
    const sum = summarizeFindings(findings);
    assert.equal(sum.gateLevel, 'none');
  });

  it('TS 有 default 分支 → LOW', () => {
    const { findings } = riskFrom({
      'src/status.ts': `
export enum Status { Open, Closed }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    default: return 'other';
  }
}
`
    }, {
      'src/status.ts': `
export enum Status { Open, Closed, Pending }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    default: return 'other';
  }
}
`
    });
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected finding, got ${findings.map((f) => f.rule)}`);
    assert.equal(hit.severity, 'low');
    assert.equal(hit.reportOnly, true);
  });

  it('switch 已覆盖新成员 → 不报', () => {
    const { findings } = riskFrom({
      'src/status.ts': `
export enum Status { Open, Closed }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    case Status.Closed: return 'closed';
  }
}
`
    }, {
      'src/status.ts': `
export enum Status { Open, Closed, Pending }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    case Status.Closed: return 'closed';
    case Status.Pending: return 'pending';
  }
}
`
    });
    assert.equal(findings.some((f) => f.rule === 'enum-exhaustiveness'), false);
  });

  it('TS 联合类型新增字面量 + if-else 未覆盖', () => {
    const { findings, head } = riskFrom({
      'src/kind.ts': `
export type Kind = 'a' | 'b';
export function label(k: Kind) {
  if (k === 'a') return 'A';
  else if (k === 'b') return 'B';
}
`
    }, {
      'src/kind.ts': `
export type Kind = 'a' | 'b' | 'c';
export function label(k: Kind) {
  if (k === 'a') return 'A';
  else if (k === 'b') return 'B';
}
`
    });
    const alias = head.nodes.find((n) => n.kind === 'type_alias' && n.name === 'Kind');
    assert.ok(alias, 'union type extracted');
    assert.ok((alias.enumValues || []).includes('c'), alias.enumValues);
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected enum-exhaustiveness, got ${findings.map((f) => f.rule)} alias=${JSON.stringify(alias.enumValues)}`);
  });

  it('Python Enum + match 缺分支', () => {
    const { findings, head } = riskFrom({
      'status.py': `
from enum import Enum
class Status(Enum):
    OPEN = 1
    CLOSED = 2
def label(s):
    match s:
        case Status.OPEN:
            return 'open'
        case Status.CLOSED:
            return 'closed'
`
    }, {
      'status.py': `
from enum import Enum
class Status(Enum):
    OPEN = 1
    CLOSED = 2
    PENDING = 3
def label(s):
    match s:
        case Status.OPEN:
            return 'open'
        case Status.CLOSED:
            return 'closed'
`
    });
    const en = head.nodes.find((n) => n.name === 'Status');
    assert.ok(en && en.kind === 'enum', en);
    assert.ok((en.enumValues || []).includes('PENDING'), en && en.enumValues);
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected enum-exhaustiveness, got ${findings.map((f) => f.rule)}`);
  });

  it('Java enum + switch 缺分支', () => {
    const { findings, head } = riskFrom({
      'src/main/java/app/Status.java': `
package app;
public enum Status { OPEN, CLOSED }
`,
      'src/main/java/app/Label.java': `
package app;
public class Label {
  public String label(Status s) {
    switch (s) {
      case OPEN: return "open";
      case CLOSED: return "closed";
    }
    return "?";
  }
}
`
    }, {
      'src/main/java/app/Status.java': `
package app;
public enum Status { OPEN, CLOSED, PENDING }
`,
      'src/main/java/app/Label.java': `
package app;
public class Label {
  public String label(Status s) {
    switch (s) {
      case OPEN: return "open";
      case CLOSED: return "closed";
    }
    return "?";
  }
}
`
    });
    const en = head.nodes.find((n) => n.kind === 'enum' && n.name === 'Status');
    assert.ok(en, 'java enum');
    assert.ok((en.enumValues || []).includes('PENDING'), en && en.enumValues);
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected enum-exhaustiveness, got ${findings.map((f) => f.rule)}`);
  });

  it('Go iota 常量 + switch 缺分支', () => {
    const { findings, head } = riskFrom({
      'status.go': `
package app
type Status int
const (
  Open Status = iota
  Closed
)
func Label(s Status) string {
  switch s {
  case Open:
    return "open"
  case Closed:
    return "closed"
  }
  return "?"
}
`
    }, {
      'status.go': `
package app
type Status int
const (
  Open Status = iota
  Closed
  Pending
)
func Label(s Status) string {
  switch s {
  case Open:
    return "open"
  case Closed:
    return "closed"
  }
  return "?"
}
`
    });
    const en = head.nodes.find((n) => n.name === 'Status' && (n.kind === 'enum' || n.enumValues));
    assert.ok(en, `go status node ${head.nodes.filter((n) => n.kind !== 'file').map((n) => n.kind + ':' + n.name)}`);
    assert.ok((en.enumValues || []).includes('Pending'), en && en.enumValues);
    const hit = findings.find((f) => f.rule === 'enum-exhaustiveness');
    assert.ok(hit, `expected enum-exhaustiveness, got ${findings.map((f) => f.rule)}`);
  });

  it('旧基线无 enumValues 不误报升级', () => {
    const dir = makeRepo({
      'src/status.ts': `
export enum Status { Open, Closed, Pending }
export function label(s: Status) {
  switch (s) {
    case Status.Open: return 'open';
    case Status.Closed: return 'closed';
  }
}
`
    });
    const head = buildGraph(dir);
    const base = JSON.parse(JSON.stringify(head));
    for (const n of base.nodes) delete n.enumValues;
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {});
    assert.equal(findings.some((f) => f.rule === 'enum-exhaustiveness'), false);
  });
});
