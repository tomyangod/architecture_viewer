# Architecture Viewer — 自托管 Web 应用
# 用法：docker build -t architecture-viewer . && docker run -p 3847:3847 architecture-viewer

FROM node:20-slim

# git 用于仓库克隆功能
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制 package.json 以利用缓存层（本项目零运行时依赖，npm install 几乎是 no-op）
COPY package.json ./

# 复制应用代码
COPY lib/ lib/
COPY web/ web/
COPY vendor/ vendor/
COPY architecture_visualized.html architecture.config.js ./
COPY AGENT.md USER_GUIDE.md CHANGELOG.md LICENSE NOTICE README.md ./

# 环境变量
ENV NODE_ENV=production
ENV PORT=3847
ENV HOST=0.0.0.0
# 以下开关按需开启：
# ENV ARCH_WEB_PATH_MODE=1      # 允许服务器本地路径输入
# ENV ARCH_WEB_PROJECTS_LIST=1  # 允许列出最近生成的项目
# ENV ARCH_WEB_SAMPLES=1        # 启用样例仓库
# ENV DEEPSEEK_API_KEY=sk-...   # 可选：LLM 精修

EXPOSE 3847

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3847/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
