/**
 * ============================================================
 *  项目架构可视化脚手架 - 配置文件
 * ============================================================
 *
 * 【集成方式】
 * 方式1: 独立使用 — 修改本文件配置 + 编辑同目录 *.md 文件，用浏览器打开 HTML
 * 方式2: URL 参数配置 — 在 HTML 路径后加 ?config=<base64编码的JSON> 或 ?tab=c4-context
 * 方式3: 编程式集成 — 在其他页面中通过 <iframe src="architecture_visualized.html?embed=1"> 嵌入
 * 方式4: 作为 npm 包使用 — 见底部 ARCHITECTURE_VIEWER 全局 API
 *
 * ============================================================
 */

(function (global) {
  'use strict';

  /**
   * ============================================================
   *  ★ 用户配置 — 把脚手架接入你的项目时，主要改这里 ★
   *  未填写的字段会回退到下方 DEFAULT_CONFIG
   * ============================================================
   */
  const USER_CONFIG = {
    project: {
      title: '项目架构可视化全景',
      subtitle: '系统架构多视图展示 · C4 模型 · 分层模块 · 代码结构 · 部署运维',
      headerIcon: '🏗️',
      footerText: '项目架构可视化 · 基于 Mermaid 11 渲染 · 支持缩放/平移/全屏交互'
    }

    // theme: { preset: 'ocean' },  // 'default' | 'light' | 'dark' | 'ocean' | 'forest' | 'sunset'

    // changelog: [
    //   { date: '2026-08-25', source: '初始导入', impact: '全量', summary: '首次接入架构可视化脚手架' }
    // ],

    // fileReferences: [
    //   { title: '核心模块', color: '#1565c0', files: ['src/core/', 'src/api/'] }
    // ]
  };

  /**
   * 默认配置模板 — 6 个标准架构视图 + 交互功能
   * 一般不必整份改写；覆盖 Tab 文案或增删视图时再改 tabs
   */
  const DEFAULT_CONFIG = {
    // ========== 集成模式配置（嵌入其他页面时使用）==========
    embed: {
      // 是否为嵌入模式（隐藏页脚、返回顶部等装饰元素）
      enabled: false,
      // 嵌入模式下默认隐藏的元素
      hideChangelog: false,
      hideFooter: false,
      hideFileReferences: false,
      hideLegend: false,
      hideHeader: false,
      // 默认激活的 tab ID
      defaultTab: null,
      // 自动隐藏工具栏（鼠标移开后淡出）
      autoHideToolbar: false,
      // 是否允许跨窗口 postMessage 通信
      enablePostMessage: true
    },

    // ========== 主题配置 ==========
    theme: {
      // 预设主题: 'default' | 'light' | 'dark' | 'ocean' | 'forest' | 'sunset'
      preset: 'default',
      // 自定义主色（覆盖 preset）
      primaryColor: null,
      // 自定义渐变色数组（2~3个颜色）
      headerGradient: null,
      // 字体
      fontFamily: null
    },

    // ========== 功能开关 ==========
    features: {
      // 是否启用缩放/平移
      zoomPan: true,
      // 是否启用全屏
      fullscreen: true,
      // 是否启用下载 PNG
      download: true,
      // 是否启用搜索模块
      search: true,
      // 是否启用节点悬停高亮
      hoverHighlight: true,
      // 是否启用点击聚焦模式
      focusMode: true,
      // 是否启用从源文件刷新
      sourceRefresh: true,
      // 是否显示交互提示气泡
      interactionTips: true
    },

    // ========== 项目基本信息 ==========
    project: {
      title: '项目架构可视化全景',
      subtitle: '系统架构多视图展示 · C4 模型 · 分层模块 · 代码结构 · 部署运维',
      headerIcon: '🏗️',
      footerText: '项目架构可视化 · 基于 Mermaid 11 渲染 · 支持缩放/平移/全屏交互'
    },

    // ========== 图例配置 ==========
    legend: [
      { icon: '👤', name: '用户角色', colorClass: 'dot-person' },
      { icon: '📦', name: '核心系统', colorClass: 'dot-system' },
      { icon: '📦', name: '服务容器', colorClass: 'dot-container' },
      { icon: '🧩', name: '功能组件', colorClass: 'dot-component' },
      { icon: '💾', name: '数据存储', colorClass: 'dot-database' },
      { icon: '🔗', name: '外部依赖', colorClass: 'dot-external' },
      { icon: '🔔', name: '监控告警', colorClass: 'dot-monitor' },
      { icon: '🎨', name: '前端界面', colorClass: 'dot-frontend' },
      { icon: '⚙️', name: '调度核心', colorClass: 'dot-core' }
    ],

    // ========== 标签页配置（6个标准架构视图）==========
    tabs: [
      {
        id: 'c4-context',
        icon: '🗺️',
        name: 'C4 Context',
        label: '系统全景',
        title: '🗺️ C4 Context - 系统全景图',
        description: '展示目标系统与外部用户、外部系统之间的交互关系，帮助理解系统在整体环境中的位置',
        difficulty: '入门级',
        difficultyClass: 'badge-easy',
        sourceFile: 'c4-context.md',
        multiBlock: true,
        // 可选：直接内联 Mermaid 代码（不需要外部 md 文件）
        // inlineMermaid: 'C4Context\n    title ...'
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '中间大框是目标系统本身；左侧是使用系统的用户角色；右侧是系统依赖的外部平台和服务。',
            '实线箭头表示主动操作/调用，虚线箭头表示数据返回/异步响应。'
          ],
          tip: '💡 核心链路：用户 → 系统 → 外部依赖 → 数据存储 → 输出结果'
        },
        flowLegend: [
          { type: 'flow-solid', text: '主动调用/操作' },
          { type: 'flow-dashed', text: '数据返回/异步响应' }
        ]
      },
      {
        id: 'c4-container',
        icon: '🏠',
        name: 'C4 Container',
        label: '容器视图',
        title: '🏠 C4 Container - 容器视图',
        description: '展示系统内部的主要运行容器/服务，以及它们之间的通信和数据流向',
        difficulty: '入门级',
        difficultyClass: 'badge-easy',
        sourceFile: 'c4-container.md',
        multiBlock: true,
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '系统按职责划分为多个容器（进程/服务），颜色从暖色到冷色区分层次。',
            '从上到下依次为：用户层 → 前端层 → 调度/核心层 → 业务逻辑层 → 数据处理层 → 存储层 → 监控告警层 → 基础设施层。'
          ],
          tip: '💡 调度/核心层是系统心脏；数据处理层负责业务流转；监控层保障系统稳定运行。'
        },
        flowLegend: [
          { type: 'flow-solid', text: '调用/数据流' },
          { type: 'flow-dotted', text: '资源使用/缓存' }
        ]
      },
      {
        id: 'c4-component',
        icon: '🔧',
        name: 'C4 Component',
        label: '组件详情',
        title: '🔧 C4 Component - 组件详情图',
        description: '深入展示各核心模块的内部组件结构，了解代码级别的功能划分',
        difficulty: '进阶级',
        difficultyClass: 'badge-medium',
        sourceFile: 'c4-component.md',
        multiBlock: true,
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '将容器进一步拆分为组件：前端组件负责用户交互、调度组件负责任务编排、业务组件负责核心逻辑、基础设施组件提供通用能力。',
            '每个子图聚焦一个容器的内部结构，箭头表示组件间的依赖/调用关系。'
          ],
          tip: '💡 关注组件边界：哪些是核心业务组件，哪些是可复用的通用组件。'
        }
      },
      {
        id: 'block',
        icon: '📦',
        name: 'Block Diagram',
        label: '分层模块',
        title: '📦 Block Diagram - 分层模块图',
        description: '按技术分层展示系统架构，从前端到后端、从业务到基础设施的完整视图',
        difficulty: '进阶级',
        difficultyClass: 'badge-medium',
        sourceFile: 'block-diagram.md',
        multiBlock: true,
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '推荐首选本视图：彩色分层框一眼区分前端 / API / 异步 / 存储 / 交付。',
            '节点写法：图标 + 中文名 + 第二行文件名或技术栈；箭头标注调用语义。',
            'C4 视图更偏标准建模、观感较素；要「像业务手绘架构图」请看本 Tab。'
          ],
          tip: '💡 实线=主数据流，虚线=部署/配置支撑。层色：粉=前端、紫=API、橙=异步、青=存储、绿=交付。'
        },
        flowLegend: [
          { type: 'flow-solid', text: '层间调用' },
          { type: 'flow-dashed', text: '基础设施支撑' }
        ]
      },
      {
        id: 'class',
        icon: '💻',
        name: 'Class Diagram',
        label: '代码结构',
        title: '💻 Class Diagram - 核心类结构',
        description: '展示后端核心类及其关系，帮助开发者快速理解代码结构和设计模式',
        difficulty: '专业级',
        difficultyClass: 'badge-hard',
        sourceFile: 'class-diagram.md',
        multiBlock: true,
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '空心三角箭头（→|>）表示继承关系；虚线箭头（..>）表示实现/创建关系；实线箭头表示依赖/使用关系。',
            '每个类列出了核心属性（-私有/+公有）和方法签名。按模块拆分子图。'
          ],
          tip: '💡 从基类开始追踪继承链，从核心入口类开始看依赖关系，可快速掌握代码结构。'
        }
      },
      {
        id: 'deployment',
        icon: '🚀',
        name: 'Deploy & Ops',
        label: '部署运维',
        title: '🚀 Deploy & Ops - 部署运维图',
        description: '运行时进程拓扑、数据资产路径、配置文件结构、健康检查机制',
        difficulty: '运维级',
        difficultyClass: 'badge-easy',
        sourceFile: 'deployment-ops.md',
        multiBlock: true,
        guide: {
          title: '🧭 阅读指南',
          paragraphs: [
            '部署运维图包含：进程拓扑（启动顺序与端口）、健康检查（如何判断服务正常）、配置文件（运行时参数）、关键数据资产（文件/数据库路径）、消费端（谁在用这些数据）。',
            '子图拆分按运维场景组织，方便快速定位故障排查入口。'
          ],
          tip: '💡 进程启动顺序 + 健康检查地址 + 关键数据路径 = 运维故障排查三件套。'
        }
      }
    ],

    // ========== 下载图片的文件名映射 ==========
    downloadFilenames: {
      'c4-context': 'C4-Context-系统全景图',
      'c4-container': 'C4-Container-容器视图',
      'c4-component': 'C4-Component-组件详情图',
      block: 'Block-Diagram-分层模块图',
      class: 'Class-Diagram-核心类结构',
      deployment: 'Deploy-Ops-部署运维图'
    },

    // ========== 更新日志（留空数组隐藏整个区域）==========
    changelog: [],

    // ========== 源文件参考（留空数组隐藏整个区域）==========
    fileReferences: []
  };

  /**
   * 深度合并工具函数
   */
  function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    const output = Array.isArray(target) ? target.slice() : Object.assign({}, target);
    Object.keys(source).forEach(key => {
      const srcVal = source[key];
      if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
        output[key] = deepMerge(output[key] || {}, srcVal);
      } else if (Array.isArray(srcVal)) {
        output[key] = srcVal.slice();
      } else {
        output[key] = srcVal;
      }
    });
    return output;
  }

  function encodeB64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function decodeB64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function isTruthyParam(v) {
    return v === '1' || v === 'true';
  }

  /**
   * 从 URL 查询字符串解析配置
   * 支持:
   *   ?config=<base64_json>   （只编码补丁，不需要整份默认配置）
   *   ?tab=c4-context&embed=1&theme=dark&hideHeader=1
   */
  function parseUrlConfig() {
    if (typeof location === 'undefined' || !location.search) return {};
    const params = new URLSearchParams(location.search);
    const cfg = {};

    const configB64 = params.get('config');
    if (configB64) {
      try {
        const raw = decodeURIComponent(configB64);
        let decoded;
        try {
          decoded = decodeB64(raw);
        } catch (e) {
          decoded = atob(raw);
        }
        Object.assign(cfg, JSON.parse(decoded));
      } catch (e) {
        console.warn('[ARCHITECTURE_VIEWER] Failed to parse URL config:', e);
      }
    }

    const embed = params.get('embed');
    if (embed !== null) {
      cfg.embed = cfg.embed || {};
      cfg.embed.enabled = isTruthyParam(embed);
    }
    const tab = params.get('tab');
    if (tab) {
      cfg.embed = cfg.embed || {};
      cfg.embed.defaultTab = tab;
    }
    ['hideHeader', 'hideFooter', 'hideChangelog', 'hideLegend', 'hideFileReferences'].forEach(function (k) {
      const v = params.get(k);
      if (v !== null) {
        cfg.embed = cfg.embed || {};
        cfg.embed[k] = isTruthyParam(v);
      }
    });
    const theme = params.get('theme');
    if (theme) {
      cfg.theme = cfg.theme || {};
      cfg.theme.preset = theme;
    }
    const primary = params.get('primary');
    if (primary) {
      cfg.theme = cfg.theme || {};
      cfg.theme.primaryColor = '#' + primary.replace(/^#/, '');
    }
    const title = params.get('title');
    if (title) {
      cfg.project = cfg.project || {};
      cfg.project.title = title;
    }

    return cfg;
  }

  /**
   * 从 window 属性获取预配置（父页面通过 JS 设置）
   */
  function getWindowPreconfig() {
    return (global && global.__ARCHITECTURE_VIEWER_CONFIG__) || {};
  }

  // 构建最终配置：DEFAULT → USER_CONFIG → window.ARCHITECTURE_CONFIG_USER__ → URL → window 预配置
  const extraUserConfig = (global && global.ARCHITECTURE_CONFIG_USER__) || {};
  const urlConfig = parseUrlConfig();
  const winConfig = getWindowPreconfig();

  let FINAL_CONFIG = deepMerge(DEFAULT_CONFIG, USER_CONFIG);
  FINAL_CONFIG = deepMerge(FINAL_CONFIG, extraUserConfig);
  FINAL_CONFIG = deepMerge(FINAL_CONFIG, urlConfig);
  FINAL_CONFIG = deepMerge(FINAL_CONFIG, winConfig);

  // 暴露到全局（旧版兼容）
  global.ARCHITECTURE_CONFIG = FINAL_CONFIG;

  // ========== 插件化公共 API ==========
  global.ARCHITECTURE_VIEWER = {
    /**
     * 获取当前生效配置
     */
    getConfig: function () {
      return FINAL_CONFIG;
    },

    /**
     * 动态覆盖配置（页面加载后也可以修改）
     */
    setConfig: function (patch) {
      FINAL_CONFIG = deepMerge(FINAL_CONFIG, patch || {});
      global.ARCHITECTURE_CONFIG = FINAL_CONFIG;
      return FINAL_CONFIG;
    },

    /**
     * 将配置对象编码为 URL 参数形式（用于 iframe src）
     */
    toUrlParams: function (cfg) {
      try {
        const b64 = encodeB64(JSON.stringify(cfg || {}));
        return 'config=' + encodeURIComponent(b64);
      } catch (e) {
        console.warn('[ARCHITECTURE_VIEWER] toUrlParams encode failed:', e);
        return '';
      }
    },

    /**
     * 创建一个内嵌 iframe 的 DOM 元素
     * @param {string} viewerUrl - architecture_visualized.html 的路径
     * @param {object} cfg - 配置对象
     * @param {object} opts - iframe 属性 {width, height, className, ...}
     * @returns {HTMLIFrameElement}
     */
    createIframe: function (viewerUrl, cfg, opts) {
      if (typeof document === 'undefined') return null;
      opts = opts || {};
      const iframe = document.createElement('iframe');
      const sep = viewerUrl.indexOf('?') >= 0 ? '&' : '?';
      iframe.src = viewerUrl + sep + global.ARCHITECTURE_VIEWER.toUrlParams(cfg);
      iframe.width = opts.width || '100%';
      iframe.height = opts.height || '800px';
      iframe.style.border = opts.border || '0';
      iframe.style.borderRadius = opts.borderRadius || '12px';
      iframe.style.boxShadow = opts.boxShadow || '0 4px 20px rgba(0,0,0,0.08)';
      if (opts.className) iframe.className = opts.className;
      if (opts.allowFullscreen !== false) {
        iframe.setAttribute('allow', 'fullscreen');
        iframe.setAttribute('allowfullscreen', '');
      }
      return iframe;
    },

    /**
     * 发送消息给嵌入的 iframe（配合 postMessage API）
     */
    postToIframe: function (iframe, message) {
      if (!iframe || !iframe.contentWindow) return false;
      try {
        iframe.contentWindow.postMessage(
          Object.assign({ __arch_viewer__: true }, message),
          '*'
        );
        return true;
      } catch (e) {
        console.warn('[ARCHITECTURE_VIEWER] postMessage failed:', e);
        return false;
      }
    },

    /**
     * 默认配置副本（用于对比/重置）
     */
    DEFAULT: JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  };

  // 如果是模块环境，导出（兼容 CommonJS / ES Module）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ARCHITECTURE_VIEWER;
  }
})(typeof window !== 'undefined' ? window : globalThis);
