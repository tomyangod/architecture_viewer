'use strict';

/**
 * VS Code Webview CSP — local origin only.
 * vscode.webview.cspSource is the webview origin (may look like a vscode-cdn host).
 * Do not add scheme wildcards or remote CDNs.
 */
const REMOTE_HOST_RE = /cdn\.jsdelivr|unpkg\.com|googleapis\.com|gstatic\.com/i;
/** `https:` / `http:` as a CSP source token, not as part of a host URL. */
const SCHEME_WILDCARD_RE = /(?:^|[\s;])https?:(?:[\s;"']|$)/i;

function webviewCspContent(cspSource) {
  const csp = String(cspSource || '').trim();
  if (!csp) throw new Error('webviewCspContent: cspSource required');
  return [
    "default-src 'none'",
    `img-src ${csp} data:`,
    `style-src ${csp} 'unsafe-inline'`,
    // mermaid 11 uses new Function for some diagram types
    `script-src ${csp} 'unsafe-inline' 'unsafe-eval'`,
    `font-src ${csp} data:`,
    `connect-src ${csp}`
  ].join('; ');
}

function webviewCspMeta(cspSource) {
  return `<meta http-equiv="Content-Security-Policy" content="${webviewCspContent(cspSource)}">`;
}

function applyWebviewCsp(html, cspSource) {
  const tag = webviewCspMeta(cspSource);
  const text = String(html || '');
  if (/<head\b/i.test(text)) {
    return text.replace(/<head\b[^>]*>/i, (open) => `${open}\n    ${tag}`);
  }
  return tag + text;
}

function cspAllowsRemote(content) {
  const s = String(content || '');
  return REMOTE_HOST_RE.test(s) || SCHEME_WILDCARD_RE.test(s);
}

module.exports = {
  webviewCspContent,
  webviewCspMeta,
  applyWebviewCsp,
  cspAllowsRemote,
  REMOTE_HOST_RE,
  SCHEME_WILDCARD_RE
};
