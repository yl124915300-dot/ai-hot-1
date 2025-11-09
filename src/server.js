// src/server.js  — AI短视频热评 后端（整合增强版）
// 功能点：
// - /api/grab  多平台抓链（抖音/快手/小红书/TikTok/哔哩）+ 小红书二次抓取补救
// - /api/comments  热评生成（有 Key 用 OpenAI；没 Key 回 Demo 示例）
// - /api/image     生图生成（有 Key 用 OpenAI；没 Key 返回占位图）
// - /healthz       健康检查
// - helmet + compression + 静态缓存（HTML no-cache，其他长缓存）
//
// 需要的环境变量：OPENAI_API_KEY（如未配置，将进入 Demo 模式）
// 可选：OPENAI_MODEL（默认 gpt-4o-mini），IMAGE_MODEL（默认 gpt-image-1）
// 运行：Render/Docker/本地 Node18+ 均可

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import compression from 'compression';
import helmet from 'helmet';
import { OpenAI } from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// —— 安全与压缩 —— //
app.use(helmet({
  contentSecurityPolicy: false,          // 便于前端内联样式，后续可细化
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

// —— 基础中间件 —— //
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// —— 静态资源（带缓存），HTML 不缓存 —— //
const oneMonth = 30 * 24 * 3600 * 1000;
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: oneMonth,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// —— OpenAI 配置 & Demo 回退 —— //
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const IMAGE_MODEL  = process.env.IMAGE_MODEL  || 'gpt-image-1';

const hasKey = !!OPENAI_API_KEY;
const openai = hasKey ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// —— 工具 & 抓链相关 —— //
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function pickUrlFromText(t) {
  if (!t) return '';
  const m = String(t).match(/https?:\/\/[^\s<>")']+/);
  return m ? m[0] : '';
}

async function fetchHtml(url, isMobile = true) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': isMobile ? UA_MOBILE : UA_DESKTOP, 'Referer': url }
  });
  const finalUrl = r.url || url;
  const html = await r.text();
  return { finalUrl, html };
}

function inferPlatform(host) {
  host = (host || '').toLowerCase();
  if (host.includes('douyin')) return 'douyin';
  if (host.includes('kuaishou') || host.includes('gifshow')) return 'kuaishou';
  if (host.includes('xiaohongshu')) return 'xiaohongshu';
  if (host.includes('tiktok')) return 'tiktok';
  if (host.includes('bilibili')) return 'bilibili';
  return 'unknown';
}

function extractMeta(html) {
  const g = (re) => { const m = html.match(re); return m ? m[1] : ''; };
  // 常见 og/meta
  const title = g(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                g(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i) ||
                g(/<title[^>]*>([^<]+)<\/title>/i);
  const image = g(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const desc  = g(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return { title, image, desc };
}

function tryMatch(html, ...regs) {
  for (const re of regs) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

// —— 小红书 noteId 与二次抓取（移动页） —— //
function xhsNoteId(u) {
  try {
    const m = String(u).match(/(?:explore|item)\/([0-9a-zA-Z]+)/);
    return m ? m[1] : '';
  } catch { return ''; }
}

async function fetchXhsMobile(noteId) {
  const url = `https://www.xiaohongshu.com/explore/${noteId}`;
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA_MOBILE, 'Referer': 'https://www.xiaohongshu.com' }
  });
  const html = await r.text();

  const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
  const title = pick(/"title"\s*:\s*"([^"]+)"/) || pick(/"noteTitle"\s*:\s*"([^"]+)"/);
  const image = pick(/"cover"\s*:\s*"([^"]+)"/) || pick(/"image"\s*:\s*"([^"]+)"/);

  const h264 = pick(/"h264"\s*:\s*"([^"]+\.mp4[^"]*)"/i);
  const m3u8 = pick(/"m3u8"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);

  return { title, image, nowm: h264 || m3u8 };
}

// —— 多平台直链抽取 —— //
function extractNowm(platform, html) {
  const m = (...regs) => tryMatch(html, ...regs);

  if (platform === 'douyin') {
    // 抖音：playAddr / srcUrls / m3u8 兜底
    return m(
      /"playAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"downloadAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /srcUrls"\s*:\s*\["([^"]+\.mp4[^"]*)"/i,
      /"m3u8_url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i
    );
  }

  if (platform === 'kuaishou') {
    // 快手：hls/e/720p/mp4 多路兜底
    return m(
      /"srcNoMark"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"photoH265Mp4Url"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"photoMp4Url"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"hlsPlayUrl"\s*:\s*"([^"]+\.m3u8[^"]*)"/i
    );
  }

  if (platform === 'xiaohongshu') {
    // 小红书：PC/H5 meta + 内嵌 JSON 兜底
    let src = m(
      /property=["']og:video["'][^>]+content=["']([^"']+\.mp4[^"']*)["']/i,
      /"h264"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"stream"\s*:\s*{[^}]*"h264"\s*:\s*"([^"]+\.mp4[^"]*)"/i
    );
    if (!src) {
      const m3u8 = m(/"m3u8"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
      if (m3u8) src = m3u8;
    }
    return src || '';
  }

  if (platform === 'tiktok') {
    return m(
      /"downloadAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
      /"playAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/i
    );
  }

  if (platform === 'bilibili') {
    return m(
      /"baseUrl"\s*:\s*"([^"]+\.m3u8[^"]*)"/i,
      /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i
    );
  }

  return '';
}

// —— 健康检查 —— //
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    model: OPENAI_MODEL,
    imageModel: IMAGE_MODEL,
    demo: !hasKey,
    time: new Date().toISOString()
  });
});

// —— 抓链 —— //
app.post('/api/grab', async (req, res) => {
  try {
    const raw = String(req.body?.text || '').trim();
    const url = pickUrlFromText(raw);
    if (!url) return res.json({ ok: false, error: '未检测到链接' });

    const { finalUrl, html } = await fetchHtml(url, true);
    const host = new URL(finalUrl).hostname;
    const platform = inferPlatform(host);
    const meta = extractMeta(html);

    let nowm = extractNowm(platform, html);

    // 小红书：PC 分享页经常抓不到，做移动页二次抓取补救
    if (platform === 'xiaohongshu' && (!meta.title || !nowm)) {
      const id = xhsNoteId(finalUrl);
      if (id) {
        try {
          const x = await fetchXhsMobile(id);
          if (x.title) meta.title = x.title;
          if (x.image) meta.image = x.image;
          if (!nowm && x.nowm) nowm = x.nowm;
        } catch {}
      }
    }

    const cleanTopic = (meta.title || '')
      .replace(/【[^】]*】/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    res.json({
      ok: true,
      platform,
      finalUrl,
      title: meta.title || '',
      cover: meta.image || '',
      desc: meta.desc || '',
      nowm: nowm || '',
      cleanTopic
    });
  } catch (e) {
    res.json({ ok: false, error: e?.message || '抓取失败' });
  }
});

// —— 热评生成 —— //
app.post('/api/comments', async (req, res) => {
  try {
    const {
      topic = '',
      material = '',
      count = 6,
      lang = 'zh',
      tone = '轻松有梗'
    } = req.body || {};

    if (!hasKey) {
      const demo = Array.from({ length: Math.max(1, Math.min(30, count)) }, (_, i) =>
        `【示例${i + 1}】${topic || '小红书'}｜简短金句（${tone}）｜中等`);
      return res.json({ ok: true, lines: demo, demo: true });
    }

    const sys = `你是短视频热评生成器。要求：每条独立、自然口语、可直接复制粘贴；避免AI腔；控制在18-42字（或对应英文/乌兹别克长度）；不要编号。`;
    const user = [
      `平台/主题：${topic || '短视频'}`,
      `语气：${tone}；语言：${lang}`,
      material ? `补充素材：${material}` : '',
      `请生成 ${Math.max(1, Math.min(30, count))} 条。`
    ].filter(Boolean).join('\n');

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0.8
    });

    const text = resp.choices?.[0]?.message?.content || '';
    const lines = text
      .split(/\r?\n/)
      .map(s => s.replace(/^\s*[-•\d.]+\s*/, '').trim())
      .filter(Boolean);

    res.json({ ok: true, lines });
  } catch (e) {
    res.json({ ok: false, error: e?.message || '生成失败' });
  }
});

// —— 生图生成 —— //
app.post('/api/image', async (req, res) => {
  try {
    const { prompt = '', size = '1024x1024' } = req.body || {};

    if (!hasKey) {
      // 占位图（前端会显示为“占位图 · 小红书”）
      return res.json({ ok: true, demo: true, urls: [], placeholder: true });
    }

    const r = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size
    });

    const urls = (r.data || [])
      .map(it => it.url)
      .filter(Boolean);

    res.json({ ok: true, urls });
  } catch (e) {
    res.json({ ok: false, error: e?.message || '生图失败' });
  }
});

// —— 单页应用：兜底返回 index.html —— //
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// —— 启动 —— //
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`HotComments server running on :${PORT} (demo=${!hasKey})`);
});
