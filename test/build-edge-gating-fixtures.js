// build edge-gating fixtures (run once offline)
// Usage: node test/build-edge-gating-fixtures.js
const {buildTree,importanceForensics,findAnchorsV2,parseMermaid,lintBlockDiagram}=require('../lib/orch/lib');
const {deterministicSweep,structureGates,visualGates,requiredLabelGate}=require('../lib/orch/run');
const {scan}=require('../lib/scan');
const fs=require('fs');
const path=require('path');
const spec=[
  {repo:'/tmp/arch-orch/repos/caddy', md:path.join(__dirname,'fixtures/usage7s-caddy/block-diagram.md'), toks:['caddy'], name:'caddy'},
  {repo:'/tmp/arch-orch/repos/ntfy', md:path.join(__dirname,'fixtures/usage7s-ntfy/block-diagram.md'), toks:['ntfy'], name:'ntfy'},
  {repo:'/tmp/arch-orch/repos/vaultwarden', md:path.join(__dirname,'fixtures/usage7s-vaultwarden/block-diagram.md'), toks:['vaultwarden','bitwarden'], name:'vaultwarden'},
  {repo:'/tmp/arch-orch/repos/zigbee2mqtt', md:path.join(__dirname,'fixtures/usage7s-zigbee2mqtt/block-diagram.md'), toks:['zigbee2mqtt'], name:'zigbee2mqtt'},
];
const out = {};
for (const s of spec) {
  const md = fs.readFileSync(s.md, 'utf8');
  const tree = buildTree(s.repo);
  const inv = scan(s.repo, {write:false});
  const imp = importanceForensics(s.repo, tree, inv.entrypoints||[]);
  const anc = findAnchorsV2(tree, imp);
  // import guessProductTokens from run.js — it's not exported, use similar heuristics
  const toks = s.toks;
  const res = deterministicSweep(md, anc, toks);
  const st = structureGates(res.md, anc, imp, toks);
  const vs = visualGates(res.md);
  const lint = lintBlockDiagram(res.md, tree);
  out[s.name] = {
    mdBefore: md,
    anchors: JSON.parse(JSON.stringify(anc)),  // findAnchorsV2 返回 anchor 对象数组
    importance: {
      // 保留 gates 真正用到的字段：info -> 我们存 path -> info map; detachedList; optionalKw
      infoMap: [...(function*(){ const paths=new Set(); const re=/<small>([\s\\S]*?)<\/small>/g; for (const m of md.matchAll(re)) for (const p of m[1].split(/<br[^>]*>|,|;/)) { const x=p.trim().replace(/^[^\w/.-]+/,''); if (x && /\//.test(x) || /\./.test(x)) yield x; } })()].reduce((m,p)=>{ try { const i = imp.info(p); if (i) m[p]=i; } catch{} return m; }, {}),
      detachedList: imp.detachedList || [],
      optionalKw: imp.optionalKw || [],
      emptyLayers: imp.emptyLayers || [],
      pathCluster: imp.pathCluster || [],
      s3Sw: imp.s3Sw || null,
      shapeConfidence: imp.shapeConfidence || 'low',
      shapeMargin: imp.shapeMargin || 0,
      shapeCandidates: imp.shapeCandidates || [],
      shape: imp.shape || null,
    },
    productTokens: toks,
    baseline: {
      sweptMd: res.md,
      sweepActions: res.actions,
      sHigh: st.filter(x=>x.severity==='high').length,
      sMed: st.filter(x=>x.severity==='medium').length,
      sLow: st.filter(x=>x.severity==='low').length,
      vHigh: vs.filter(x=>x.severity==='high').length,
      hallucination: lint.metrics.幻觉路径数||0,
      qualityScore: Math.max(0,10-((lint.metrics.幻觉路径数||0)*10+st.filter(x=>x.severity==='high').length*5+st.filter(x=>x.severity==='medium').length*1+vs.filter(x=>x.severity==='high').length*2)),
    }
  };
  console.log(s.name+': baseline', JSON.stringify(out[s.name].baseline));
}
fs.writeFileSync(path.join(__dirname,'fixtures','edge-gating-fixtures.json'), JSON.stringify(out,null,2));
console.log('wrote', path.join(__dirname,'fixtures','edge-gating-fixtures.json'));
