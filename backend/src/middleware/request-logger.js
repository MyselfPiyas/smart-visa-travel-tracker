export default function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    // Log only method, pathname, status, and duration. Do not log query strings,
    // request bodies, headers, or uploaded file details because they may be sensitive.
    const pathname = (req.originalUrl || req.url).split('?')[0];
    console.info(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
}
