export const canHandle = (u) =>
  /(youtube\.com|youtu\.be)/.test(new URL(u).hostname);

export const resolve = async (url) => {
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const r = await fetch(oembed, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) {
      const j = await r.json();
      return {
        platform: "YouTube",
        title: j.title || "",
        summary: "",
        link: url,
        image: j.thumbnail_url || ""
      };
    }
  } catch {}
  return { platform: "YouTube", title: "[YouTube] 视频", summary: "", link: url };
};
