import { fetchHtml, extractOG } from "../utils/fetchHtml.js";

export const canHandle = (u) =>
  /instagram\.com/.test(new URL(u).hostname);

export const resolve = async (url) => {
  const token = process.env.IG_OEMBED_TOKEN; // IG_APP_ID|IG_APP_SECRET
  if (token) {
    const o = `https://graph.facebook.com/v17.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
    try {
      const r = await fetch(o, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) {
        const j = await r.json();
        return {
          platform: "Instagram",
          title: j.title || "[Instagram] 内容",
          summary: "",
          link: url,
          image: j.thumbnail_url || ""
        };
      }
    } catch {}
  }
  try {
    const { status, html } = await fetchHtml(url);
    if (status >= 200 && status < 400 && html.includes("<")) {
      const og = extractOG(html);
      return {
        platform: "Instagram",
        title: og.title || "[Instagram] 内容",
        summary: og.desc || "",
        link: url,
        image: og.img || ""
      };
    }
  } catch {}
  return { platform: "Instagram", title: "[Instagram] 内容", summary: "", link: url };
};
