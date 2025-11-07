import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || '你是一个短视频评论生成器，基于输入的主题和视频信息，生成一句简洁有梗、易共鸣、适合中文社媒的热评。语气自然，避免夸张广告语。';

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

app.get('/healthz', (_req, res) => res.json({ ok: true, model: MODEL, time: new Date().toISOString() }));

app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.post('/api/generate-hot-comment', async (req, res) => {
  try {
    const { prompt, tone = '轻松有梗', length = 40 } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt 必填' });
    if (!openai) return res.json({ comment: `【本地模式示例】${prompt.slice(0,20)}… ｜ ${tone} ｜ ~${length}字` });
    const userPrompt = `视频要点：${prompt}
语气：${tone}
长度：~${length}字
要求：口语自然、上手即用、不要话术和表情洪流，像真实热评。只返回一句评论。`;
    const resp = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 120
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    res.json({ comment: text });
  } catch (e) {
    res.status(500).json({ error: '生成失败', detail: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log('Listening on', PORT));
