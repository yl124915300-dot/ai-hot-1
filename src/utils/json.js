export const ok = (res, data) => res.json({ ok: true, data });
export const fail = (res, message, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, message, ...extra });

export const forceJsonForApi = (req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  next();
};
