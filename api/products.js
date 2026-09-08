const { clientToken, json } = require("./lib/kroger");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    const term = (url.searchParams.get("term") || "").trim();
    const locationId = (url.searchParams.get("locationId") || "").trim();
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "8", 10), 1),
      50
    );

    if (!term) {
      return json(res, 400, {
        error: "Missing product search term."
      });
    }

    if (!locationId) {
      return json(res, 400, {
        error: "Missing Kroger locationId."
      });
    }

    const token = await clientToken();

    const params = new URLSearchParams();
    params.set("filter.term", term);
    params.set("filter.locationId", locationId);
    params.set("filter.limit", String(limit));

    const krogerUrl =
      `https://api.kroger.com/v1/products?${params.toString()}`;

    const response = await fetch(krogerUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      console.error("Kroger Products API error:", {
        status: response.status,
        body: data
      });

      return json(res, response.status, {
        error: "Kroger Products API rejected the request.",
        krogerStatus: response.status,
        krogerError: data
      });
    }

    const products = Array.isArray(data.data)
      ? data.data.map((product) => {
          const item = product.items?.[0] || {};
          const price = item.price?.regular ?? item.price?.promo ?? null;

          let modality = "ais";

          if (item.fulfillment?.csp) modality = "csp";
          else if (item.fulfillment?.dth) modality = "dth";
          else if (item.fulfillment?.sth) modality = "sth";
          else if (item.fulfillment?.ais) modality = "ais";

          return {
            upc: product.upc || product.productId || "",
            productId: product.productId || "",
            description: product.description || "Kroger Product",
            brand: product.brand || "",
            price,
            image:
              product.images?.[0]?.sizes?.find(
                (img) => img.size === "medium"
              )?.url ||
              product.images?.[0]?.sizes?.[0]?.url ||
              "",
            modality
          };
        })
      : [];

    return json(res, 200, {
      data: products,
      meta: data.meta || {}
    });
  } catch (error) {
    console.error("Products endpoint error:", error);

    return json(res, 500, {
      error: "Products endpoint failed.",
      message: error.message
    });
  }
};