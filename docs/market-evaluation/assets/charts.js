(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var CJK = "'Outfit','PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif";

  // ---------- Chart 1: 入门价格带对比 ----------
  var priceEl = document.getElementById('chart-price');
  if (priceEl) {
    var priceData = [
      { name: 'Swark（开源）', v: 0 },
      { name: 'Mermaid Chart 扩展', v: 0 },
      { name: 'draw.io', v: 0 },
      { name: 'Architecture Viewer Pro', v: 4 },
      { name: 'Mermaid Chart 商业版', v: 8 },
      { name: 'Eraser Starter', v: 15 },
      { name: 'Windsurf Pro', v: 15 },
      { name: 'Cursor Pro', v: 20 },
      { name: 'Structurizr On-prem（折算）', v: 19 },
      { name: 'Eraser Business', v: 45 },
      { name: 'IcePanel Growth', v: 40 }
    ];
    var c1 = echarts.init(priceEl, null, { renderer: 'svg' });
    c1.setOption({
      animation: false,
      textStyle: { fontFamily: CJK, color: ink },
      grid: { left: 170, right: 60, top: 20, bottom: 30 },
      tooltip: {
        appendToBody: true,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (p) { return p[0].name + '<br/>入门价：<b>$' + p[0].value + '</b> / 人·月'; }
      },
      xAxis: {
        type: 'value',
        name: '$ / 人·月',
        nameTextStyle: { color: muted, fontFamily: CJK },
        axisLabel: { color: muted, fontFamily: CJK },
        splitLine: { lineStyle: { color: rule } },
        axisLine: { lineStyle: { color: rule } }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: priceData.map(function (d) { return d.name; }),
        axisLabel: {
          color: function (v) { return v.indexOf('Architecture Viewer') >= 0 ? accent : ink; },
          fontFamily: CJK,
          fontWeight: function (v) { return v.indexOf('Architecture Viewer') >= 0 ? 'bold' : 'normal'; }
        },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        data: priceData.map(function (d) {
          return {
            value: d.v,
            itemStyle: {
              color: d.name.indexOf('Architecture Viewer') >= 0
                ? { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: accent }, { offset: 1, color: accent2 }] }
                : (d.v === 0 ? accent2 + '55' : accent + '88'),
              borderRadius: [0, 6, 6, 0]
            }
          };
        }),
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          color: ink,
          fontFamily: CJK,
          formatter: function (p) { return p.value === 0 ? '免费' : '$' + p.value; }
        }
      }]
    });
    window.addEventListener('resize', function () { c1.resize(); });
  }

  // ---------- Chart 2: 六维能力雷达 ----------
  var radarEl = document.getElementById('chart-radar');
  if (radarEl) {
    var c2 = echarts.init(radarEl, null, { renderer: 'svg' });
    c2.setOption({
      animation: false,
      textStyle: { fontFamily: CJK, color: ink },
      legend: {
        bottom: 0,
        textStyle: { color: ink, fontFamily: CJK },
        itemWidth: 16, itemHeight: 10
      },
      tooltip: { appendToBody: true },
      radar: {
        indicator: [
          { name: 'AI 生成能力', max: 5 },
          { name: '仓库内嵌 / 轻量', max: 5 },
          { name: '漂移检测深度', max: 5 },
          { name: 'C4 六视图专业度', max: 5 },
          { name: '协作成熟度', max: 5 },
          { name: '中文 / 本地化', max: 5 }
        ],
        radius: '62%',
        center: ['50%', '48%'],
        axisName: { color: ink, fontFamily: CJK, fontSize: 13 },
        splitLine: { lineStyle: { color: rule } },
        splitArea: { areaStyle: { color: [bg2, 'transparent'] } },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'radar',
        data: [
          {
            name: 'Architecture Viewer（目标）',
            value: [4, 5, 4, 4, 1, 5],
            lineStyle: { color: accent, width: 2.5 },
            itemStyle: { color: accent },
            areaStyle: { color: accent + '22' }
          },
          {
            name: 'Mermaid Chart 扩展',
            value: [4, 3, 3, 1, 4, 2],
            lineStyle: { color: accent2, width: 2 },
            itemStyle: { color: accent2 },
            areaStyle: { color: accent2 + '18' }
          },
          {
            name: 'Structurizr',
            value: [3, 3, 5, 5, 4, 1],
            lineStyle: { color: warn, width: 2 },
            itemStyle: { color: warn },
            areaStyle: { color: warn + '14' }
          },
          {
            name: 'Eraser.io',
            value: [5, 2, 3, 2, 5, 2],
            lineStyle: { color: muted, width: 2, type: 'dashed' },
            itemStyle: { color: muted },
            areaStyle: { color: muted + '10' }
          }
        ]
      }]
    });
    window.addEventListener('resize', function () { c2.resize(); });
  }

  // ---------- Chart 3: 收入情景 ----------
  var scEl = document.getElementById('chart-scenario');
  if (scEl) {
    var c3 = echarts.init(scEl, null, { renderer: 'svg' });
    c3.setOption({
      animation: false,
      textStyle: { fontFamily: CJK, color: ink },
      grid: { left: 70, right: 40, top: 40, bottom: 40 },
      tooltip: {
        appendToBody: true,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (p) {
          var d = p[0];
          var ranges = {
            '乐观（原方案假设）': '5k 安装 × 2% 付费 × ¥35',
            '保守（0.5–1% 转化）': '5k 安装 × 0.5–1% × ¥29',
            '保守 + Team 年费': '个人 ¥700–1,500 + 1–2 仓库 × ¥999/年'
          };
          return d.name + '<br/>' + ranges[d.name] + '<br/>月收入：<b>¥' + d.value + 'k</b>';
        }
      },
      xAxis: {
        type: 'category',
        data: ['乐观（原方案假设）', '保守（0.5–1% 转化）', '保守 + Team 年费'],
        axisLabel: { color: ink, fontFamily: CJK, interval: 0, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '¥k / 月',
        nameTextStyle: { color: muted, fontFamily: CJK },
        axisLabel: { color: muted, fontFamily: CJK },
        splitLine: { lineStyle: { color: rule } },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'bar',
        barWidth: 64,
        data: [
          { value: 3.5, itemStyle: { color: muted + '66', borderRadius: [8, 8, 0, 0] } },
          { value: 1.4, itemStyle: { color: accent2 + 'aa', borderRadius: [8, 8, 0, 0] } },
          { value: 2.6, itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: accent }, { offset: 1, color: accent2 }] },
            borderRadius: [8, 8, 0, 0]
          } }
        ],
        label: {
          show: true, position: 'top', color: ink, fontFamily: CJK, fontWeight: 'bold',
          formatter: function (p) { return '¥' + p.value + 'k'; }
        },
        markLine: {
          symbol: 'none',
          lineStyle: { color: warn, type: 'dashed' },
          label: { color: warn, fontFamily: CJK, formatter: '副业可持续线 ≈ ¥2k' },
          data: [{ yAxis: 2 }]
        }
      }]
    });
    window.addEventListener('resize', function () { c3.resize(); });
  }
})();
