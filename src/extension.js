'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
  initKit,
  findKitDir,
  generateForRepo,
  checkKit,
  agentPrompt
} = require('../lib');

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder ? folder.uri.fsPath : null;
}

function requireRoot() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Architecture Viewer: 请先打开一个工作区文件夹');
    return null;
  }
  return root;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('architectureViewer.init', async () => {
      const root = requireRoot();
      if (!root) return;
      const destRel = vscode.workspace.getConfiguration('architectureViewer').get('outputDir') || 'architecture_viewer';
      const result = initKit(root, destRel);
      vscode.window.showInformationMessage('已初始化架构套件：' + result.dest);
      const readme = path.join(result.dest, 'AGENT.md');
      if (fs.existsSync(readme)) {
        await vscode.window.showTextDocument(vscode.Uri.file(readme), { preview: true });
      }
    }),

    vscode.commands.registerCommand('architectureViewer.generate', async () => {
      const root = requireRoot();
      if (!root) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Architecture Viewer: 扫描并生成六视图' },
        async () => {
          const destRel = vscode.workspace.getConfiguration('architectureViewer').get('outputDir') || 'architecture_viewer';
          const result = generateForRepo(root, destRel);
          const errs = result.protocol.errors.length + (result.drift.ok ? 0 : result.drift.missing.length);
          const msg = errs
            ? `已生成，但有 ${errs} 个校验/漂移问题，请运行 Validate`
            : `已生成 6 个视图 → ${result.kitDir}`;
          vscode.window.showInformationMessage(msg);
        }
      );
    }),

    vscode.commands.registerCommand('architectureViewer.validate', async () => {
      const root = requireRoot();
      if (!root) return;
      const kit = findKitDir(root);
      if (!kit) {
        vscode.window.showWarningMessage('未找到 architecture_viewer 套件，请先运行 Init');
        return;
      }
      const result = checkKit(kit, { requireFilled: true, drift: true, repo: root });
      const lines = [
        ...result.protocol.errors.map((e) => 'ERROR  ' + e),
        ...result.protocol.warnings.map((w) => 'WARN   ' + w),
        ...(result.drift && result.drift.missing ? result.drift.missing.map((m) => `DRIFT  ${m.label}`) : [])
      ];
      const doc = await vscode.workspace.openTextDocument({
        content: lines.length ? lines.join('\n') : 'OK — protocol + drift checks passed\n' + kit,
        language: 'plaintext'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      if (!result.ok) {
        vscode.window.showErrorMessage('Architecture Viewer: 校验未通过（图源协议或代码漂移）');
      } else {
        vscode.window.showInformationMessage('Architecture Viewer: 校验通过');
      }
    }),

    vscode.commands.registerCommand('architectureViewer.preview', async () => {
      const root = requireRoot();
      if (!root) return;
      const kit = findKitDir(root);
      if (!kit) {
        vscode.window.showWarningMessage('未找到套件，请先 Init 或 Generate');
        return;
      }
      await openPreview(context, kit);
    }),

    vscode.commands.registerCommand('architectureViewer.copyAgentPrompt', async () => {
      const root = requireRoot();
      if (!root) return;
      const destRel = vscode.workspace.getConfiguration('architectureViewer').get('outputDir') || 'architecture_viewer';
      const text = agentPrompt(root, destRel);
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage('已复制 Cursor Agent 提示词，在 Chat 中粘贴以精修图（可用登录额度）');
    })
  );
}

async function openPreview(context, kitDir) {
  const panel = vscode.window.createWebviewPanel(
    'architectureViewer.preview',
    'Architecture Viewer',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(kitDir),
        vscode.Uri.file(path.join(context.extensionPath, 'vendor'))
      ]
    }
  );
  panel.webview.html = buildPreviewHtml(panel.webview, kitDir, context.extensionPath);
}

function buildPreviewHtml(webview, kitDir, extensionPath) {
  const htmlPath = path.join(kitDir, 'architecture_visualized.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const configPath = path.join(kitDir, 'architecture.config.js');
  const configJs = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const sources = {};
  for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md', 'block-diagram.md', 'class-diagram.md', 'deployment-ops.md']) {
    const p = path.join(kitDir, f);
    if (fs.existsSync(p)) sources[f] = fs.readFileSync(p, 'utf8');
  }
  const mermaidKit = path.join(kitDir, 'vendor', 'mermaid.min.js');
  const mermaidExt = path.join(extensionPath || '', 'vendor', 'mermaid.min.js');
  const mermaidFile = fs.existsSync(mermaidKit) ? mermaidKit : mermaidExt;
  const mermaidUri = webview.asWebviewUri(vscode.Uri.file(mermaidFile)).toString();
  const csp = webview.cspSource;
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline' 'unsafe-eval'; font-src ${csp} data:; connect-src ${csp};">`;
  html = html.replace('<head>', `<head>\n    ${cspTag}`);
  html = html.replace('src="vendor/mermaid.min.js"', 'src="' + mermaidUri + '"');
  const inject = `<script>window.__ARCH_INLINE_SOURCES__ = ${JSON.stringify(sources)};</script>`;
  html = html.replace(
    '<script src="architecture.config.js"></script>',
    `<script>${configJs}</script>\n    ${inject}`
  );
  return html;
}

function deactivate() {}

module.exports = { activate, deactivate, buildPreviewHtml };
