const success = (res, data, meta = {}, statusCode = 200) => {
  return res.status(statusCode).json({ success: true, data, meta });
};

module.exports = { success };
