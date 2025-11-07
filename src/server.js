// src/server.js —— HotComments 商用版（首页 + 热评 + 抓链 + 生图 + 健康检查）
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

dotenv.config();

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  '你是一个短视频评论生成器，基于输入的主题和视频信息，生成一句简洁有梗、易共鸣、适合中文社媒的热评。语气自然，避免夸张广告语。';

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

/* ----------- 基础路由 ----------- */
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, model: MODEL, time: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

/* ----------- 1) 生成热评 ----------- */
app.post('/api/generate-hot-comment', async (req, res) => {
  try {
    const { prompt, tone = '轻松有梗', length = 40 } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt 必填' });
    }

    // 无 key 的演示返回
    if (!openai) {
      return res.json({
        comment: `【示例】${prompt.slice(0, 20)}…（语气：${tone}，约${length}字）`
      });
    }

    const userPrompt =
      `视频要点：${prompt}\n` +
      `语气：${tone}\n` +
      `长度：~${length}字\n` +
      `要求：口语自然、上手即用、不要口号和营销话术。只返回一句评论。`;

    const resp = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 120
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    res.json({ comment: text || '（未生成内容）' });
  } catch (err) {
    res.status(500).json({ error: '生成失败', detail: String(err?.message || err) });
  }
});

/* ----------- 2) 抓链（通用解析） ----------- */
// 从文本里提取首个 URL
function pickUrl(text = '') {
  const m = String(text).match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : '';
}

// 解析 HTML 的 og: 元信息
function parseMeta(html = '') {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    title:
      pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<title>([^<]+)<\/title>/i),
    description:
      pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    image:
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    site:
      pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  };
}

app.post('/api/extract-link', async (req, res) => {
  try {
    const { text } = req.body || {};
    const url = pickUrl(text);
    if (!url) return res.status(400).json({ error: '未检测到链接' });

    // 使用 Node 18 自带 fetch，设置移动端 UA，便于抖音/快手短链 302 跟随
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': ua } });
    const finalUrl = r.url;
    const html = await r.text();
    const meta = parseMeta(html);

    res.json({
      ok: true,
      url,
      finalUrl,
      title: meta.title || '',
      description: meta.description || '',
      image: meta.image || '',
      site: meta.site || new URL(finalUrl).hostname
    });
  } catch (err) {
    res.status(500).json({ error: '抓链失败', detail: String(err?.message || err) });
  }
});

/* ----------- 3) 生图（OpenAI Images） ----------- */
app.post('/api/gen-image', async (req, res) => {
  try {
    const { prompt, size = '512x512' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt 必填' });

    // 无 key：返回占位图
    if (!openai) {
      return res.json({
        placeholder: true,
        dataUrl:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" fill="#0f1630"/><text x="50%" y="50%" fill="#a7b5ff" font-size="22" text-anchor="middle" dominant-baseline="middle">示例占位图：${prompt.slice(
              0,
              18
            )}</text></svg>`
          )
      });
    }

    // OpenAI Images API
    const resp = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size
    });

    const b64 = resp?.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: '生成图片失败' });
    res.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    res.status(500).json({ error: '生图失败', detail: String(err?.message || err) });
  }
});

/* ----------- 启动 ----------- */
app.listen(PORT, () => console.log('HotComments listening on', PORT));
