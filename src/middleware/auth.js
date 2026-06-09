function requireLogin(req, res, next) {
  if (req.session && req.session.usuario) {
    return next();
  }
  res.redirect('/login');
}

module.exports = { requireLogin };