export default function errorHandler(error, _req, res, _next) {
  // Error messages can contain user input; keep operational logs low-detail.
  console.error('Request failed:', error?.name || 'Error', Number(error?.status) || 500);
  if (res.headersSent) return;
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
  res.status(status).json({
    error: { message: status === 500 ? 'An unexpected server error occurred' : error.message },
  });
}
