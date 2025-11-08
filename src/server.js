// src/server.js —— 热评君AI（运营后端整合版）
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

dotenv.config();

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(morgan('tiny'));

// ---- 配置 ----
const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const IMG_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

// 简易配额：内存版（按 IP/天）
const FREE = { comments: 20, images: 5 };
const PRO  = { comments: 200, images: 50 };
const usage = new Map();   // key: day#ip -> {plan, cmt, img}
const proSet = new Set();  // day#ip 标记 PRO
const REDEEM_CODE = process.env.REDEEM_CODE || 'PRO-2025';

function dayKey() { return new Date().toISOString().slice(0,10); }
function getIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}
function getUsage(req) {
  const key = `${dayKey()}#${getIP(req)}`;
  if (!usage.has(key)) usage.set(key, { plan: 'free', cmt: 0, img: 0 });
  if (proSet.has(key)) usage.get(key).plan = 'pro';
  return { key, data: usage.get(key) };
}
function getLimit(plan) { return plan === 'pro' ? PRO : FREE; }

// ---- 健康检查 & 静态 ----
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, model: MODEL, imageModel: IMG_MODEL, time: new Date().toISOString() });
});
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// ---- 配额 ----
app.get('/api/quota', (req, res) => {
  const { data } = getUsage(req);
  const limit = getLimit(data.plan);
  res.json({
    plan: data.plan,
    daily: {
      comments: { used: data.cmt, total: limit.comments },
      images:   { used: data.img, total: limit.images }
    }
  });
});

// ---- 兑换升级 ----
app.post('/api/redeem', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const { key, data } = getUsage(req);
  if (!code) return res.status(400).json({ error: '兑换码不能为空' });
  if (code !== REDEEM_CODE) return res.status(400).json({ error: '兑换码无效' });
  data.plan = 'pro';
  proSet.add(key);
  res.json({ ok: true, plan: 'pro' });
});

// ---- 生成热评 ----
app.post('/api/generate', async (req, res) => {
  const { data } = getUsage(req);
  const limit = getLimit(data.plan);
  if (data.cmt >= limit.comments) return res.status(402).json({ error: '评论配额已用完' });

  const {
    platform = 'douyin',
    lang = 'zh',
    tone = '简短金句',
    count = 6,
    length = '中等',
    topic = '',
    context = ''
  } = req.body || {};

  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: '请提供 topic（视频主题关键词）' });
  }

  // 无 key：返回示例便于联调
  if (!openai) {
    data.cmt++;
    const demo = Array.from({ length: Number(count) || 3 }).map((_, i) =>
      `【示例${i+1}】${topic.slice(0,20)}｜${tone}｜${length}`
    );
    return res.json({ data: demo, demo: true });
  }

  const lenHint = length === '短句' ? '每句 10-18 字'
                 : length === '长文' ? '每句 30-50 字'
                 : '每句 18-28 字';

  const sys = '你是短视频热评写手，写出像真实用户的口语化评论。拒绝营销话术、拒绝表情符号堆砌；不涉敏感与引战；内容要贴合视频主题与语气要求。只给纯文本，每行一条。';
  const user =
`平台：${platform}
语言：${lang}
口吻：${tone}
条数：${count}
长度建议：${lenHint}
视频主题关键词：${topic}
补充素材（可选）：${context || '（无）'}
请输出 ${count} 条，逐行返回。`;

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0.7
    });
    const text = resp?.choices?.[0]?.message?.content?.trim() || '';
    const lines = text.split(/\r?\n/).map(s => s.replace(/^\d+[\.\)\-]\s*/, '').trim()).filter(Boolean);
    data.cmt++;
    res.json({ data: lines.length ? lines : [text] });
  } catch (e) {
    res.status(503).json({ error: String(e?.message || e) });
  }
});

// ---- AI 生图 ----
app.post('/api/image', async (req, res) => {
  const { data } = getUsage(req);
  const limit = getLimit(data.plan);
  if (data.img >= limit.images) return res.status(402).json({ error: '图片配额已用完' });

  const { prompt = '', negative = '', size = '1024x1024', quality = 'high' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 必填' });

  if (!openai) {
    data.img++;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
        <rect width="100%" height="100%" fill="#0f1630"/>
        <text x="50%" y="50%" fill="#a7b5ff" font-size="28" text-anchor="middle" dominant-baseline="middle">
          占位图 · ${prompt.slice(0,18)}
        </text>
      </svg>`;
    return res.json({ dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), demo: true });
  }

  const fullPrompt = `${prompt}${negative ? `\n\n[Avoid]: ${negative}` : ''}`;

  try {
    const gen = await openai.images.generate({
      model: IMG_MODEL,
      prompt: fullPrompt,
      size,
      quality
    });
    const b64 = gen?.data?.[0]?.b64_json;
    if (!b64) return res.status(503).json({ error: '生成失败' });
    data.img++;
    res.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(503).json({ error: String(e?.message || e) });
  }
});

// ---- 抓链（含抖音去水印直链尝试）----
app.post('/api/grab', async (req, res) => {
  try {
    const raw = String(req.body?.url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return res.status(400).json({ error: 'url 无效' });
    const m0 = raw.match(/https?:\/\/[^\s]+/i);
    const url = m0 ? m0[0] : raw;

    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': ua } });
    const finalUrl = r.url;
    const html = await r.text();

    const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
    const meta = {
      title:
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<title>([^<]+)<\/title>/i),
      description:
        pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
      image: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
      site:  pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    };

    const host = new URL(finalUrl).hostname.toLowerCase();
    let platform = 'unknown';
    if (host.includes('douyin')) platform = 'douyin';
    else if (host.includes('kuaishou')) platform = 'kuaishou';
    else if (host.includes('xiaohongshu') || host.includes('xhs')) platform = 'xiaohongshu';
    else if (host.includes('bilibili') || host.includes('b23')) platform = 'bilibili';
    else if (host.includes('tiktok')) platform = 'tiktok';
    else if (host.includes('youtube') || host.includes('youtu')) platform = 'youtube';

    const cleanTopic =
      (meta.title || '')
        .replace(/[#@][\w\u4e00-\u9fa5\-]+/g, '')
        .replace(/[|｜·•\-—_]+/g, ' ')
        .trim();

    // 抖音去水印直链（best-effort）
    let nowm = '';
    if (platform === 'douyin') {
      const tryMatch = (...res) => {
        for (const re of res) {
          const m = html.match(re);
          if (m && m[1]) return m[1];
        }
        return '';
      };
      let playAddr = tryMatch(
        /"playAddr"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
        /playAddr:\s*"([^"]+\.mp4[^"]*)"/i,
        /"src"\s*:\s*"([^"]+\.mp4[^"]*)"/i
      );
      let playwm = tryMatch(
        /"playwm"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
        /playwm:\s*"([^"]+\.mp4[^"]*)"/i
      );
      if (!playAddr) {
        const urlsBlock = tryMatch(/"urls"\s*:\s*\[([^\]]+)\]/i);
        if (urlsBlock) {
          const firstUrl = (urlsBlock.match(/https?:\/\/[^"',\]]+\.mp4[^"',\]]*/i) || [])[0];
          if (firstUrl) playAddr = firstUrl;
        }
      }
      if (!playAddr && playwm) playAddr = playwm.replace('playwm', 'play');
      if (playAddr) nowm = playAddr;
    }

    res.json({
      ok: true,
      url,
      finalUrl,
      platform,
      title: meta.title || '',
      description: meta.description || '',
      image: meta.image || '',
      cleanTopic,
      nowm
    });
  } catch (e) {
    res.status(503).json({ error: String(e?.message || e) });
  }
});

// ---- 启动 ----
app.listen(PORT, () => {
  console.log('HotCommenter server listening on', PORT);
});
