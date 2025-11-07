// src/server.js  —— 正式版（支持静态首页 + 健康检查 + 生成热评 API）
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

dotenv.config();

// 解决 __dirname 在 ESModule 中不可用的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  '你是一个短视频评论生成器，基于输入的主题和视频信息，生成一句简洁有梗、易共鸣、适合中文社媒的热评。语气自然，避免夸张广告语。';

// OpenAI 客户端（没有 Key 时走本地示例返回，便于无密钥也能演示）
const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

// 健康检查
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, model: MODEL, time: new Date().toISOString() });
});

// 静态资源与首页（public/ 目录）
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 生成热评 API
app.post('/api/generate-hot-comment', async (req, res) => {
  try {
    const { prompt, tone = '轻松有梗', length = 40 } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt 必填' });
    }

    // 无密钥时返回本地示例，方便前端联调
    if (!openai) {
      return res.json({
        comment: `【本地示例】${prompt.slice(0, 20)}… ｜ 语气：${tone} ｜ ~${length}字`
      });
    }

    const userPrompt =
      `视频要点：${prompt}\n` +
      `语气：${tone}\n` +
      `长度：~${length}字\n` +
      `要求：口语自然、上手即用、不要话术和表情洪流，像真实热评。只返回一句评论。`;

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
    res.status(500).json({
      error: '生成失败',
      detail: String(err?.message || err)
    });
  }
});

// 启动
app.listen(PORT, () => {
  console.log('HotComments listening on', PORT);
});
