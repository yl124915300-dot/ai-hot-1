import { fetchHtml, extractOG } from "../utils/fetchHtml.js";

export const canHandle = (u) =>
  /(tiktok\.com|douyin\.com)/.test(new URL(u).hostname);

export const resolve = async (url) => {
  // TikTok 优先 oEmbed
  if (/tiktok\.com/.test(url)) {
    const o = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    try {
      const r = await fetch(o, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) {
        const j = await r.json();
        return {
          platform: "TikTok",
          title: j.title || "",
          summary: "",
          link: url,
          image: j.thumbnail_url || ""
        };
      }
    } catch {}
  }
  // 其余走 OG/title 降级
  try {
    const { status, html } = await fetchHtml(url);
    if (status >= 200 && status < 400 && html.includes("<")) {
      const og = extractOG(html);
      return {
        platform: "TikTok",
        title: og.title || "[TikTok/抖音] 视频",
        summary: og.desc || "",
        link: url,
        image: og.img || ""
      };
    }
  } catch {}
  return { platform: "TikTok", title: "[TikTok/抖音] 视频", summary: "", link: url };
};
