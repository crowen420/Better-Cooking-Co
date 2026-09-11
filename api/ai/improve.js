const handler = require("../../index.js");
module.exports = (req, res) => {
  const q = req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = "/api/ai/improve" + q;
  return handler(req, res);
};
