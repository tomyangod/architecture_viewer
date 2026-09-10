(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // ---------- Mermaid ----------
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose', flowchart: { htmlLabels: true } });
  }

  // ---------- Radar: capability dimensions ----------
  var radarEl = document.getElementById('chart-radar');
  if (radarEl && window.echarts) {
    var radar = echarts.init(radarEl, null, { renderer: 'svg' });
    radar.setOption({
      animation: false,
      color: [muted, accent],
      legend: {
        top: 0,
        data: ['现状（实测评分）', 'W22 完成后（目标值）'],
        textStyle: { color: ink, fontSize: 13 }
      },
      tooltip: { appendToBody: true },
      radar: {
        indicator: [
          { name: '结构变更检测', max: 10 },
          { name: '签名契约检测', max: 10 },
          { name: '行为一致性检测', max: 10 },
          { name: '测试耦合感知', max: 10 },
          { name: '语义规则（枚举/异常/流）', max: 10 },
          { name: 'AI 事实接地评审', max: 10 }
        ],
        radius: '62%',
        center: ['50%', '56%'],
        axisName: { color: ink, fontSize: 13 },
        splitLine: { lineStyle: { color: rule } },
        splitArea: { areaStyle: { color: [bg2, 'transparent'] } },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'radar',
        data: [
          {
            value: [8, 1, 1, 0, 1, 2],
            name: '现状（实测评分）',
            areaStyle: { color: muted + '33' },
            lineStyle: { color: muted, width: 2 },
            itemStyle: { color: muted }
          },
          {
            value: [9, 8, 7, 7, 6, 6],
            name: 'W22 完成后（目标值）',
            areaStyle: { color: accent + '33' },
            lineStyle: { color: accent, width: 2.5 },
            itemStyle: { color: accent }
          }
        ]
      }]
    });
    window.addEventListener('resize', function () { radar.resize(); });
  }

  // ---------- Bar: effort & rules per phase ----------
  var effortEl = document.getElementById('chart-effort');
  if (effortEl && window.echarts) {
    var bar = echarts.init(effortEl, null, { renderer: 'svg' });
    bar.setOption({
      animation: false,
      color: [accent, accent2],
      tooltip: { appendToBody: true, trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        top: 0,
        data: ['工作量（人日）', '新增规则数'],
        textStyle: { color: ink, fontSize: 13 }
      },
      grid: { left: 48, right: 48, top: 48, bottom: 40 },
      xAxis: {
        type: 'category',
        data: ['W19 调用图+签名', 'W20 行为指纹+测试', 'W21 语义规则族', 'W22 AI 事实评审'],
        axisLabel: { color: muted, fontSize: 12, interval: 0 },
        axisLine: { lineStyle: { color: rule } }
      },
      yAxis: [
        {
          type: 'value', name: '人日', max: 5,
          nameTextStyle: { color: muted },
          axisLabel: { color: muted },
          splitLine: { lineStyle: { color: rule } }
        },
        {
          type: 'value', name: '规则数', max: 5,
          nameTextStyle: { color: muted },
          axisLabel: { color: muted },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: '工作量（人日）', type: 'bar', barWidth: 34,
          data: [4, 3, 4, 3],
          itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', color: ink, fontWeight: 700 }
        },
        {
          name: '新增规则数', type: 'bar', barWidth: 34, yAxisIndex: 1,
          data: [2, 2, 4, 0],
          itemStyle: { color: accent2, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', color: ink, fontWeight: 700 }
        }
      ]
    });
    window.addEventListener('resize', function () { bar.resize(); });
  }
})();
