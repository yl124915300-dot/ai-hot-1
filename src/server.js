import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DEMO = !process.env.OPENAI_API_KEY;

// ====== 基础中间件 ======
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(compression());

// 兼容各种前端提交方式（很关键）
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use((req, _res, next) => {
  // 如果是 text/plain/raw，也读取成字符串再帮忙转
  if (
    req.headers["content-type"] &&
    req.headers["content-type"].includes("text/plain")
  ) {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        req.body = JSON.parse(buf);
      } catch {
        req.body = { text: buf };
      }
      next();
    });
  } else {
    next();
  }
});

// 保证 /api/* 一定返回 JSON（避免落到 index.html）
app.use("/api", (req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// ====== 小工具 ======
const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, message, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, message, ...extra });

const pickFirstUrl = (text = "") => {
  // 更强：过滤中文引号/括号/emoji，提取第一个 http(s)
  const cleaned = String(text)
    .replace(/[【】《》「」“”‘’（）()\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ");
  const m = cleaned.match(/https?:\/\/[^\s<>"'，、。；]+/i);
  return m ? m[0] : "";
};

const detectPlatform = (url = "") => {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h.includes("xiaohongshu")) return "小红书";
    if (h.includes("douyin")) return "抖音";
    if (h.includes("kuaishou") || h.includes("gifshow")) return "快手";
    if (h.includes("bilibili")) return "B站";
    if (h.includes("youtube") || h.includes("youtu.be")) return "YouTube";
    return "未知";
  } catch {
    return "未知";
  }
};

const fetchHtml = async (url) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: url,
      },
    });
    const html = await r.text();
    return { status: r.status, html };
  } finally {
    clearTimeout(t);
  }
};

const extractTitle = (html = "") => {
  let m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return m[1].trim().replace(/\s+/g, " ").slice(0, 120);
  m = html.match(/"title"\s*:\s*"([^"]{1,200})"/i);
  if (m) return m[1];
  return "";
};

// ====== 健康检查 ======
app.get("/healthz", (req, res) =>
  ok(res, {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    imageModel: process.env.IMAGE_MODEL || "gpt-image-1",
    demo: DEMO,
    time: new Date().toISOString(),
  })
);

// ====== API：抓链 ======
app.post("/api/scrape", async (req, res) => {
  try {
    const text =
      (typeof req.body === "string" && req.body) ||
      req.body?.text ||
      req.body?.content ||
      "";
    const link = pickFirstUrl(text);
    if (!link) return fail(res, "未发现有效链接");

    const platform = detectPlatform(link);

    // 抓取标题（失败也降级，不会 undefined）
    let title = "";
    try {
      const { status, html } = await fetchHtml(link);
      if (status >= 200 && status < 400 && html.includes("<")) {
        title = extractTitle(html);
      }
    } catch (_) {}

    if (!title) title = `[${platform}] 内容`;

    // 关键词种子：用于自动填到“视频主题关键词”
    const keywordsSeed = [platform, title].filter(Boolean).join(" | ");

    ok(res, {
      platform,
      title,
      summary: "",
      link,
      keywordsSeed,
    });
  } catch (e) {
    fail(res, e?.message || "抓取失败", 500);
  }
});

// ====== API：生成热评 ======
app.post("/api/comments", async (req, res) => {
  try {
    const {
      topic = "",
      tone = "简短金句",
      level = "中等",
      count = 6,
      lang = "中文",
    } = req.body || {};

    if (!topic && DEMO) {
      const arr = Array.from({ length: Number(count) || 6 }).map(
        (_, i) => `【示例${i + 1}】${tone} | ${level} | ${lang}`
      );
      return ok(res, { comments: arr, demo: true });
    }

    if (!process.env.OPENAI_API_KEY)
      return fail(res, "未配置 OPENAI_API_KEY", 500);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const sys = `你是短视频热评创作助手。输出${lang}，风格「${tone}」，情感强度「${level}」。只输出句子本身，不要编号与引号。每条不超过40字。`;
    const user = `根据以下主题/关键词生成 ${count} 条短视频热评：\n${topic}`;

    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.8,
    });

    const text = resp.choices?.[0]?.message?.content || "";
    const lines = text
      .split(/\n+/)
      .map((s) => s.replace(/^[\s•\-\d\.\)【】\[\]]+/g, "").trim())
      .filter(Boolean)
      .slice(0, Number(count) || 6);

    ok(res, { comments: lines });
  } catch (e) {
    fail(res, e?.message || "生成失败", 500);
  }
});

// ====== API：生图 ======
app.post("/api/image", async (req, res) => {
  try {
    const { prompt = "", size = "1024x1024", seed = "" } = req.body || {};
    if (DEMO) return ok(res, { url: `/placeholder-${size}.png`, demo: true });

    if (!process.env.OPENAI_API_KEY)
      return fail(res, "未配置 OPENAI_API_KEY", 500);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const finalPrompt =
      prompt?.trim() ||
      "蓝紫霓虹赛博风，居中‘热评君AI’立体字样，适合作为短视频缩略图";

    const img = await client.images.generate({
      model: process.env.IMAGE_MODEL || "gpt-image-1",
      prompt: finalPrompt,
      size,
      ...(seed ? { seed } : {}),
    });

    const url = img.data?.[0]?.url;
    if (!url) return fail(res, "生成图片失败", 500);
    ok(res, { url });
  } catch (e) {
    fail(res, e?.message || "生成图片失败", 500);
  }
});

// ====== /api 404 也要返回 JSON，避免 '<' 报错 ======
app.use("/api", (req, res) => fail(res, "API not found", 404));

// ====== 静态与兜底（最后） ======
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h" }));
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "public", "index.html"))
);

// ====== 启动 ======
app.listen(PORT, () => {
  console.log(`HotComments server running on :${PORT} (demo=${DEMO})`);
});
