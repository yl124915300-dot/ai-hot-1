import * as youtube from "./youtube.js";
import * as tiktok from "./tiktok.js";
import * as instagram from "./instagram.js";
import * as xhs from "./xiaohongshu.js";

export const PROVIDERS = [youtube, tiktok, instagram, xhs];

export const resolveByUrl = async (url) => {
  for (const p of PROVIDERS) {
    try {
      if (p.canHandle?.(url)) return await p.resolve(url);
    } catch (e) {
      console.error(`[resolver:${p?.name || "unknown"}]`, e?.message);
    }
  }
  return { platform: "未知", title: "短视频内容", summary: "", link: url };
};
