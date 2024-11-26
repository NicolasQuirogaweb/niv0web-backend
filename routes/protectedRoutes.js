  const express = require('express');
  const router = express.Router();
  const authenticateJWT = require('../middleware/authenticateJWT');

  // Ruta protegida
  router.get('/protected-data', authenticateJWT, (req, res) => {
    res.json({ message: 'This is protected data', user: req.user });
  });

  module.exports = router;
