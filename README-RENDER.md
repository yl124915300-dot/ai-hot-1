# 一键部署到 Render（免服务器 / 免命令行）

这是 **AI 短视频评论应用** 的“一键部署蓝图”。只需把仓库连到 Render，即可自动构建与上线；之后每次 push 代码都会自动更新。

## 部署步骤（2~3 分钟）
1. 把本项目上传到你的 GitHub 仓库（网页 → Add file → Upload files，上传整个解压后的文件夹内容）。
2. 打开 https://render.com → 登录 → 右上角 **New + → Blueprint**。
3. 在 *Public Git Repository* 输入框粘贴你的 GitHub 仓库地址（包含本文件 `render.yaml`）。
4. **Connect** → 在生成的服务中添加环境变量：
   - `OPENAI_API_KEY`：你的 OpenAI Key
   - 其他变量已默认：`OPENAI_MODEL=gpt-4o-mini`、`PORT=8080`
5. 点击 **Apply**，等待 1~2 分钟，Render 会给出公开访问地址。

## 验证
- 打开提供的 URL，看到页面即可；
- 健康检查：访问 `https://你的域名/healthz` 返回 `{ ok: true }` 即正常；
- 生成接口：`POST /api/generate-hot-comment`（Body 见源码）。

## 后续运维
- 每次 push 到 GitHub：Render 自动构建并上线；
- 日志/回滚/扩容：在 Render 控制台一键操作；
- 商用建议：绑定自有域名（自动 HTTPS）；访问量上来后把 `plan: free` 升级到 `starter/standard`。

## 本地调试（可选）
```bash
cp .env.example .env
# 填入 OPENAI_API_KEY
npm ci || npm install
npm run dev
# http://localhost:8080
```
