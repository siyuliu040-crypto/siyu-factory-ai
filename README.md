# UGC AI Studio

一个可部署的 AI 图片/视频生成工作台。浏览器只请求本项目自己的 API 路由，服务端再代理到 HellobabyGo / New API 网关，API Key 不会暴露给前端访客。

## 功能

- 图片生成：`POST /api/images/start` 创建后台任务，`GET /api/images/status?id=...` 查询进度
- 图片参考图：当前生产入口先关闭参考图编辑，避免上游不稳定模型误扣费
- 视频生成：`POST /api/videos/generate` -> HellobabyGo `/v1/videos`
- 视频多参考图：支持多个 `input_reference`
- 视频状态：`GET /api/videos/:id` -> HellobabyGo `/v1/videos/:id`
- 视频预览/下载：`GET /api/videos/:id/content` -> HellobabyGo `/v1/videos/:id/content`
- 模型列表：`GET /api/models` -> HellobabyGo `/v1/models`
- 剩余额度：`GET /api/quota` -> HellobabyGo `/api/usage/token`
- 中英文切换、充值入口、余额不足提示

## 本地运行

```bash
cp .env.example .env
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

`.env` 示例：

```bash
HELLOBABYGO_API_BASE_URL=https://api.hellobabygo.com
HELLOBABYGO_API_KEY=你的服务端 API Key
```

## 部署到 Render

项目已经包含 `render.yaml`，可作为 Render Blueprint 导入。线上需要设置环境变量：

```text
HELLOBABYGO_API_BASE_URL=https://api.hellobabygo.com
HELLOBABYGO_API_KEY=你的服务端 API Key
```

Render Web Service 配置：

- Build Command: `npm ci && node node_modules/next/dist/bin/next build`
- Start Command: `node scripts/start.mjs`
- Runtime: Node
- Node Version: `24`

## 安全说明

- 不要把真实 API Key 写进前端代码。
- 不要提交 `.env`。
- 线上必须把 `HELLOBABYGO_API_KEY` 配成服务端环境变量。
