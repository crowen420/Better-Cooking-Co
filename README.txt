COOK BETTER CO. V2 — VERCEL + KROGER

Project structure:
- index.html
- api/stores.js
- api/products.js
- api/auth/kroger.js
- api/auth/kroger/callback.js
- api/auth/status.js
- api/auth/logout.js
- api/cart/add.js
- api/lib/kroger.js
- .env.example
- .gitignore

Deploy the folder root directly to Vercel. Do not use server.js, Express, vercel.json rewrites, or a catch-all API.

Vercel environment variables:
KROGER_CLIENT_ID
KROGER_CLIENT_SECRET
KROGER_REDIRECT_URI = https://cookbetterco.vercel.app/api/auth/kroger/callback
KROGER_SCOPES = cart.basic:write product.compact profile.compact
SESSION_SECRET = long random value

Kroger Developer redirect URI must exactly match:
https://cookbetterco.vercel.app/api/auth/kroger/callback

The client secret is only used by Vercel server functions. It is not in index.html.
