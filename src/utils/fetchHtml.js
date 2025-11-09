export const fetchHtml = async (url) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: url
      }
    });
    return { status: r.status, html: await r.text() };
  } finally { clearTimeout(t); }
};

export const extractOG = (html) => {
  const get = (p) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, "i"));
    return m ? m[1] : "";
  };
  const title = get("og:title") || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const desc  = get("og:description");
  const img   = get("og:image");
  return { title, desc, img };
};
