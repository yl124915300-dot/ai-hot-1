import { fetchHtml, extractOG } from "../utils/fetchHtml.js";

export const canHandle = (u) => {
  const h = new URL(u).hostname;
  return /xiaohongshu\.com$/.test(h) || /xhslink\.com$/.test(h);
};

export const resolve = async (url) => {
  try {
    const { status, html } = await fetchHtml(url);
    if (status >= 200 && status < 400 && html.includes("<")) {
      const og = extractOG(html);
      return {
        platform: "小红书",
        title: og.title || "[小红书] 笔记/视频",
        summary: og.desc || "",
        link: url,
        image: og.img || ""
      };
    }
  } catch {}
  return { platform: "小红书", title: "[小红书] 笔记/视频", summary: "", link: url };
};
