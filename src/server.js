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
const DEMO = !process.env.OPENAI_API_KEY; // 没配 key 就走演示模式

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));

// ---------- 工具 ----------
const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, message, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, message, ...extra });

const pickFirstUrl = (text = "") => {
  const m = String(text).match(
    /(https?:\/\/[^\s\u4e00-\u9fa5<>"]+)/i
  );
  return m ? m[1] : "";
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
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
  if (m) return m[1].trim().replace(/\n+/g, " ").slice(0, 120);
  m = html.match(/"title"\s*:\s*"([^"]{1,200})"/i);
  if (m) return m[1];
  return "";
};

// ---------- API 路由（务必在静态托管与兜底前面） ----------
app.get("/healthz", (req, res) => {
  ok(res, {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    imageModel: process.env.IMAGE_MODEL || "gpt-image-1",
    demo: DEMO,
    time: new Date().toISOString(),
  });
});

// 抓链：从文本里取第一个链接，试图抓 title，取不到也返回平台与原始链接
app.post("/api/scrape", async (req, res) => {
  try {
    const { text = "" } = req.body || {};
    const link = pickFirstUrl(text);
    if (!link) return fail(res, "未发现有效链接");

    const platform = detectPlatform(link);
    let title = "";
    let summary = "";

    // 尝试抓 title（被风控也没关系，会降级）
    try {
      const { status, html } = await fetchHtml(link);
      if (status >= 200 && status < 400 && html && html.includes("<")) {
        title = extractTitle(html);
      }
    } catch (_) {}

    // 降级策略：标题还是空，就用平台+短链后缀
    if (!title) {
      title = `[${platform}] 内容`;
    }

    ok(res, {
      platform,
      title,
      summary,
      link,
      // 给前端的关键词种子
      keywordsSeed: [platform, title].filter(Boolean).join(" | "),
    });
  } catch (e) {
    fail(res, e?.message || "抓取失败", 500);
  }
});

// 生成热评
app.post("/api/comments", async (req, res) => {
  try {
    const { topic = "", tone = "简短金句", level = "中等", count = 6, lang = "中文" } =
      req.body || {};

    if (!topic && DEMO) {
      // demo 模式：返回伪造数据，不调模型
      const arr = Array.from({ length: Number(count) || 6 }).map(
        (_, i) => `【示例${i + 1}】${tone} | ${topic || "主题"} | ${level} | ${lang}`
      );
      return ok(res, { comments: arr, demo: true });
    }

    if (!process.env.OPENAI_API_KEY) return fail(res, "服务未配置 OPENAI_API_KEY", 500);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const sys = `你是短视频热评创作助手。输出${lang}，风格为「${tone}」，情感强度「${level}」。只输出句子本身，不要编号。`;
    const user = `根据以下主题/关键词生成 ${count} 条短视频热评：\n${topic}\n每条不超过40字；尽量口语化，避免“AI腔”。`;

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

// 生成图片
app.post("/api/image", async (req, res) => {
  try {
    const { prompt = "", size = "1024x1024", seed = "" } = req.body || {};
    if (DEMO) {
      // demo 模式：返回站内占位图
      return ok(res, { url: `/placeholder-${size}.png`, demo: true });
    }
    if (!process.env.OPENAI_API_KEY) return fail(res, "服务未配置 OPENAI_API_KEY", 500);

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

// ---------- 静态托管与兜底 ----------
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h" }));

// 兜底只在最后：避免把 /api/* 也回成 index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`HotComments server running on :${PORT} (demo=${DEMO})`);
});
