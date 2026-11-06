export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { message: 'Please sign in to continue.' } });
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: { message: 'You do not have access to this area.' } });
    return next();
  };
}
