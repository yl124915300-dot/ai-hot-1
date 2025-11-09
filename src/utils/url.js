export const pickFirstUrl = (text = "") => {
  const cleaned = String(text)
    .replace(/[【】《》「」“”‘’（）()\u{1F300}-\u{1FAFF}]/gu, " ")
    .replace(/\s+/g, " ");
  const m = cleaned.match(/https?:\/\/[^\s<>"'，、。；]+/i);
  return m ? m[0] : "";
};

export const detectPlatform = (url = "") => {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (/(^|\.)xiaohongshu\.com$/.test(h) || /xhslink\.com$/.test(h)) return "小红书";
    if (/(^|\.)douyin\.com$/.test(h) || /(^|\.)tiktok\.com$/.test(h)) return "TikTok";
    if (/(^|\.)youtube\.com$/.test(h) || /youtu\.be$/.test(h)) return "YouTube";
    if (/(^|\.)instagram\.com$/.test(h)) return "Instagram";
    return "未知";
  } catch { return "未知"; }
};
