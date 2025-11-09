import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";

import { ok, fail, forceJsonForApi } from "./utils/json.js";
import { pickFirstUrl } from "./utils/url.js";
import { resolveByUrl } from "./providers/index.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 8080);
const DEMO = !process.env.OPENAI_API_KEY;

// 基础中间件
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(compression());

// 解析多种请求体
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use((req, _res, next) => {
  if (req.headers["content-type"]?.includes("text/plain")) {
    let buf = ""; req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => { try { req.body = JSON.parse(buf); } catch { req.body = { text: buf }; } next(); });
  } else next();
});

// API 始终返回 JSON（避免 Unexpected token '<'）
app.use("/api", forceJsonForApi);

// 健康检查
app.get("/healthz", (req, res) =>
  ok(res, {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    imageModel: process.env.IMAGE_MODEL || "gpt-image-1",
    demo: DEMO,
    time: new Date().toISOString(),
  })
);

// 抓链：识别平台 + 标题/摘要/封面
app.post("/api/scrape", async (req, res) => {
  try {
    const text = (typeof req.body === "string" && req.body) || req.body?.text || req.body?.content || "";
    const link = pickFirstUrl(text);
    if (!link) return fail(res, "未发现有效链接");
    const meta = await resolveByUrl(link);
    const keywordsSeed = [meta.platform, meta.title].filter(Boolean).join(" | ");
    ok(res, { ...meta, keywordsSeed });
  } catch (e) {
    fail(res, e?.message || "抓取失败", 500);
  }
});

// 生成热评
app.post("/api/comments", async (req, res) => {
  try {
    const { topic = "", tone = "简短金句", level = "中等", count = 6, lang = "中文" } = req.body || {};
    if (!topic && DEMO) {
      const arr = Array.from({ length: Number(count) || 6 }).map((_, i) => `【示例${i + 1}】${tone} | ${level} | ${lang}`);
      return ok(res, { comments: arr, demo: true });
    }
    if (!process.env.OPENAI_API_KEY) return fail(res, "未配置 OPENAI_API_KEY", 500);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const sys = `你是短视频热评创作助手。输出${lang}，风格「${tone}」，情感强度「${level}」。只输出句子本身，不要编号与引号。每条不超过40字。`;
    const user = `根据以下主题/关键词生成 ${count} 条短视频热评：\n${topic}`;

    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.8
    });
    const text = resp.choices?.[0]?.message?.content || "";
    const lines = text.split(/\n+/)
      .map((s) => s.replace(/^[\s•\-\d\.\)【】\[\]]+/g, "").trim())
      .filter(Boolean).slice(0, Number(count) || 6);

    ok(res, { comments: lines });
  } catch (e) { fail(res, e?.message || "生成失败", 500); }
});

// AI 生图
app.post("/api/image", async (req, res) => {
  try {
    const { prompt = "", size = "1024x1024", seed = "" } = req.body || {};
    if (DEMO) return ok(res, { url: `/placeholder-${size}.png`, demo: true });
    if (!process.env.OPENAI_API_KEY) return fail(res, "未配置 OPENAI_API_KEY", 500);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const finalPrompt = prompt?.trim() || "蓝紫霓虹赛博风，居中‘热评君AI’立体字样，适合作为短视频缩略图";

    const img = await client.images.generate({
      model: process.env.IMAGE_MODEL || "gpt-image-1",
      prompt: finalPrompt,
      size,
      ...(seed ? { seed } : {})
    });

    const url = img.data?.[0]?.url;
    if (!url) return fail(res, "生成图片失败", 500);
    ok(res, { url });
  } catch (e) { fail(res, e?.message || "生成图片失败", 500); }
});

// /api 未命中兜底
app.use("/api", (_req, res) => fail(res, "API not found", 404));

// 静态资源与 SPA 路由
const pub = path.join(__dirname, "..", "public");
app.use(express.static(pub, { maxAge: "1h" }));
app.get("*", (_req, res) => res.sendFile(path.join(pub, "index.html")));

app.listen(PORT, () => console.log(`Server on :${PORT} demo=${DEMO}`));
