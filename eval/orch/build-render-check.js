/**
 * 构建渲染对比页：把 7 份 block-diagram.md 的 mermaid 块内联进一个 HTML，
 * 使用仓库 vendor/mermaid.min.js 离线渲染，供浏览器验证渲染/控制台错误。
 * 用法: node eval/orch/build-render-check.js <out.html>
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const mermaidJs = fs.readFileSync(path.join(root, 'vendor', 'mermaid.min.js'), 'utf8');

const CANDS = [
  ['method1 · Cursor Agent（人工基准）', '/tmp/arch-compare/method1-cursor-agent/block-diagram.md'],
  ['method5 · DeepSeek 全树手写引擎', '/tmp/arch-compare/method5-deepseek-handwriter/block-diagram.md'],
  ['digest · 扫描摘要单轮', '/tmp/arch-orch/out/digest/block-diagram.md'],
  ['rich1 · 全树+摘录单轮', '/tmp/arch-orch/out/rich1/block-diagram.md'],
  ['nocritic · 流水线(无批判)', '/tmp/arch-orch/out/nocritic/block-diagram.md'],
  ['orch · 裸眼批判', '/tmp/arch-orch/out/orch/block-diagram.md'],
  ['orch2 · 接地批判+层闸门', '/tmp/arch-orch/out/orch2/block-diagram.md']
];

const sections = CANDS.map(([title, file], i) => {
  const md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '（缺失）';
  const m = md.match(/```mermaid\r?\n([\s\S]*?)```/);
  const code = m ? m[1].replace(/\r\n/g, '\n') : 'flowchart LR\n  missing["无 mermaid 块"]';
  return `<section><h2>${i + 1}. ${title}</h2><div class="diagram" id="d${i}"><pre class="mermaid" data-src='${JSON.stringify(code)}'>${code.replace(/</g, '&lt;')}</pre></div></section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>编排流水线渲染对比</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #f5f6f8; }
  header { position: sticky; top: 0; background: #1f2937; color: #fff; padding: 12px 20px; font-size: 15px; z-index: 10; }
  section { background: #fff; margin: 16px 20px; padding: 8px 16px 16px; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h2 { font-size: 15px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
  .diagram { overflow: auto; }
  .err { color: #b91c1c; font-family: monospace; white-space: pre-wrap; }
</style>
<script>${mermaidJs}</script>
</head><body>
<header>编排流水线 7 变体 block-diagram 渲染对比（离线 mermaid）</header>
${sections}
<script>
  window.__renderErrors = [];
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { htmlLabels: true } });
  (async () => {
    const blocks = document.querySelectorAll('.mermaid');
    let i = 0;
    for (const b of blocks) {
      try {
        const { svg } = await mermaid.render('rend' + (i++), b.textContent);
        b.innerHTML = svg;
      } catch (e) {
        window.__renderErrors.push({ index: i, message: String(e.message || e) });
        b.classList.add('err');
        b.textContent = '渲染错误: ' + (e.message || e);
      }
    }
    window.__renderDone = true;
  })();
</script>
</body></html>`;

const out = path.resolve(process.argv[2] || '/tmp/arch-orch/out/render-check.html');
fs.writeFileSync(out, html);
console.log('wrote', out, '(', html.length, 'chars )');
