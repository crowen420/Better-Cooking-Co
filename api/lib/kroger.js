const crypto = require("crypto");

const API = "https://api.kroger.com/v1";
const TOKEN = "https://api.kroger.com/v1/connect/oauth2/token";
const AUTHORIZE = "https://api.kroger.com/v1/connect/oauth2/authorize";

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function redirectUri(req) {
  return (
    process.env.KROGER_REDIRECT_URI ||
    `https://${req.headers.host}/api/auth/kroger/callback`
  );
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function go(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.end();
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

/*
 * Get a Kroger application token.
 *
 * This is used for public APIs such as:
 * - Locations
 * - Products
 */
async function clientToken() {
  const clientId = required("KROGER_CLIENT_ID");
  const clientSecret = required("KROGER_CLIENT_SECRET");

  const basic = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const body = new URLSearchParams();

  body.set("grant_type", "client_credentials");

  // Request the scopes configured for this application.
  body.set(
    "scope",
    process.env.KROGER_SCOPES ||
      "product.compact"
  );

  const response = await fetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Kroger token endpoint returned invalid JSON: ${text}`
    );
  }

  if (!response.ok) {
    console.error("Kroger token error:", data);

    throw new Error(
      `Kroger token request failed (${response.status}): ${
        data.error_description ||
        data.error ||
        data.reason ||
        "Unknown error"
      }`
    );
  }

  if (!data.access_token) {
    throw new Error("Kroger token response did not contain access_token");
  }

  return data.access_token;
}

/*
 * Encrypt the user's Kroger OAuth session.
 */
function encryptSession(payload) {
  const secret = required("SESSION_SECRET");

  const key = crypto
    .createHash("sha256")
    .update(secret)
    .digest();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptSession(value) {
  if (!value) return null;

  try {
    const secret = required("SESSION_SECRET");

    const key = crypto
      .createHash("sha256")
      .update(secret)
      .digest();

    const [iv64, tag64, data64] = value.split(".");

    const iv = Buffer.from(iv64, "base64url");
    const tag = Buffer.from(tag64, "base64url");
    const encrypted = Buffer.from(data64, "base64url");

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      iv
    );

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    console.error("Session decrypt failed:", error);
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  const cookies = {};

  header.split(";").forEach(part => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function setCookie(res, name, value, options = {}) {
  let cookie =
    `${name}=${encodeURIComponent(value)}; Path=/;`;

  if (options.httpOnly !== false) {
    cookie += " HttpOnly;";
  }

  if (options.secure !== false) {
    cookie += " Secure;";
  }

  cookie += " SameSite=Lax;";

  if (options.maxAge !== undefined) {
    cookie += ` Max-Age=${options.maxAge};`;
  }

  const existing = res.getHeader("Set-Cookie");

  const cookies = existing
    ? Array.isArray(existing)
      ? existing
      : [existing]
    : [];

  cookies.push(cookie);

  res.setHeader("Set-Cookie", cookies);
}

function clearCookie(res, name) {
  setCookie(res, name, "", {
    maxAge: 0
  });
}

function userSession(req) {
  const cookies = parseCookies(req);

  return decryptSession(
    cookies.cb_kroger_session
  );
}

module.exports = {
  API,
  TOKEN,
  AUTHORIZE,
  required,
  redirectUri,
  json,
  go,
  readBody,
  clientToken,
  encryptSession,
  decryptSession,
  parseCookies,
  setCookie,
  clearCookie,
  userSession
};