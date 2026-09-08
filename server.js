require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

const KROGER_API = "https://api.kroger.com/v1";
const KROGER_OAUTH = "https://api.kroger.com/v1/connect/oauth2";

const CLIENT_ID = process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;

const REDIRECT_URI =
  process.env.KROGER_REDIRECT_URI ||
  "https://cookbetterco.com/callback";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
==================================================
TEMPORARY IN-MEMORY DATA
==================================================
*/

const sessions = new Map();
const customers = new Map();
const oauthStates = new Map();

let nextCustomerId = 1;

let krogerToken = null;
let krogerRefreshToken = null;
let krogerTokenExpiresAt = 0;

/*
==================================================
RECIPES
==================================================
*/

const RECIPES = {
  spaghetti: {
    id: "spaghetti",
    name: "Spaghetti & Meatballs",
    category: "Fan Favorite",
    baseServings: 2,
    ingredients: [
      ["Spaghetti", 8, "oz", "spaghetti"],
      ["Ground Beef", 1, "lb", "ground beef"],
      ["Tomato Sauce", 15, "oz", "tomato sauce"],
      ["Yellow Onion", 0.5, "lb", "yellow onion"],
      ["Garlic", 2, "cloves", "garlic"]
    ]
  },

  chicken: {
    id: "chicken",
    name: "Lemon Herb Chicken",
    category: "Chicken",
    baseServings: 2,
    ingredients: [
      ["Chicken Breast", 1, "lb", "chicken breast"],
      ["Lemon", 2, "each", "lemon"],
      ["Garlic", 3, "cloves", "garlic"],
      ["Olive Oil", 2, "tbsp", "olive oil"],
      ["Fresh Parsley", 1, "bunch", "fresh parsley"]
    ]
  },

  grilledChicken: {
    id: "grilledChicken",
    name: "Smoky Grilled Chicken",
    category: "Grilled Chicken",
    baseServings: 2,
    ingredients: [
      ["Chicken Breast", 1.5, "lb", "chicken breast"],
      ["Lemon", 1, "each", "lemon"],
      ["Garlic", 3, "cloves", "garlic"],
      ["BBQ Sauce", 0.5, "bottle", "bbq sauce"]
    ]
  },

  bbqChicken: {
    id: "bbqChicken",
    name: "BBQ Chicken Dinner",
    category: "Grilled Chicken",
    baseServings: 2,
    ingredients: [
      ["Chicken Thighs", 2, "lb", "chicken thighs"],
      ["BBQ Sauce", 1, "bottle", "bbq sauce"],
      ["Corn", 4, "each", "corn"],
      ["Green Beans", 1, "lb", "green beans"]
    ]
  },

  mexicanChicken: {
    id: "mexicanChicken",
    name: "Mexican Street Chicken",
    category: "Grilled Chicken",
    baseServings: 2,
    ingredients: [
      ["Chicken Breast", 1.5, "lb", "chicken breast"],
      ["Lime", 3, "each", "lime"],
      ["Corn Tortillas", 8, "each", "corn tortillas"],
      ["Cotija Cheese", 4, "oz", "cotija cheese"]
    ]
  },

  teriyakiChicken: {
    id: "teriyakiChicken",
    name: "Teriyaki Chicken",
    category: "Asian Chicken",
    baseServings: 2,
    ingredients: [
      ["Chicken Breast", 1.5, "lb", "chicken breast"],
      ["Teriyaki Sauce", 1, "bottle", "teriyaki sauce"],
      ["Broccoli", 1, "lb", "broccoli"],
      ["White Rice", 1, "lb", "white rice"]
    ]
  },

  beefBroccoli: {
    id: "beefBroccoli",
    name: "Beef & Broccoli",
    category: "Asian",
    baseServings: 2,
    ingredients: [
      ["Beef Steak", 1, "lb", "beef steak"],
      ["Broccoli", 1, "lb", "broccoli"],
      ["White Rice", 1, "cup", "white rice"],
      ["Soy Sauce", 3, "tbsp", "soy sauce"],
      ["Garlic", 2, "cloves", "garlic"]
    ]
  },

  tacos: {
    id: "tacos",
    name: "Chicken Tacos",
    category: "Mexican",
    baseServings: 2,
    ingredients: [
      ["Chicken Breast", 1, "lb", "chicken breast"],
      ["Flour Tortillas", 8, "each", "flour tortillas"],
      ["Cheddar Cheese", 1, "cup", "shredded cheddar cheese"],
      ["Tomatoes", 2, "each", "tomatoes"],
      ["Lettuce", 1, "head", "lettuce"],
      ["Sour Cream", 1, "cup", "sour cream"]
    ]
  },

  pastaAlfredo: {
    id: "pastaAlfredo",
    name: "Creamy Garlic Alfredo",
    category: "Pasta",
    baseServings: 2,
    ingredients: [
      ["Penne Pasta", 8, "oz", "penne pasta"],
      ["Heavy Cream", 1, "pint", "heavy cream"],
      ["Parmesan Cheese", 4, "oz", "parmesan cheese"],
      ["Garlic", 3, "cloves", "garlic"]
    ]
  },

  brownies: {
    id: "brownies",
    name: "Fudgy Brownies",
    category: "Dessert",
    baseServings: 8,
    ingredients: [
      ["Brownie Mix", 1, "box", "brownie mix"],
      ["Eggs", 2, "each", "eggs"],
      ["Butter", 0.5, "lb", "butter"]
    ]
  }
};

/*
==================================================
ACCOUNT HELPERS
==================================================
*/

function createSession(customerId) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    customerId
  });

  return token;
}

function getCustomer(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7);
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  return customers.get(session.customerId) || null;
}

function requireCustomer(req, res, next) {
  const customer = getCustomer(req);

  if (!customer) {
    return res.status(401).json({
      error: "You must be logged in."
    });
  }

  req.customer = customer;
  next();
}

/*
==================================================
KROGER AUTH
==================================================
*/

function authHeader() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Kroger credentials are not configured.");
  }

  return (
    "Basic " +
    Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")
  );
}

async function getKrogerAccessToken() {
  if (
    krogerToken &&
    Date.now() < krogerTokenExpiresAt - 60000
  ) {
    return krogerToken;
  }

  if (krogerRefreshToken) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: krogerRefreshToken
      });

      const response = await fetch(
        `${KROGER_OAUTH}/token`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader(),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );

      const data = await response.json();

      if (response.ok && data.access_token) {
        krogerToken = data.access_token;

        krogerRefreshToken =
          data.refresh_token || krogerRefreshToken;

        krogerTokenExpiresAt =
          Date.now() +
          Number(data.expires_in || 1800) * 1000;

        return krogerToken;
      }
    } catch (error) {
      console.error("Kroger refresh error:", error);
    }
  }

  throw new Error("Kroger is not connected.");
}

/*
==================================================
HEALTH
==================================================
*/

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Cook Better Co."
  });
});

/*
==================================================
ACCOUNTS
==================================================
*/

app.post("/api/account/register", (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      error: "Name, email and password are required."
    });
  }

  const normalizedEmail =
    String(email).trim().toLowerCase();

  for (const customer of customers.values()) {
    if (customer.email === normalizedEmail) {
      return res.status(409).json({
        error: "An account with that email already exists."
      });
    }
  }

  const customer = {
    id: String(nextCustomerId++),
    name: String(name).trim(),
    email: normalizedEmail,
    password,
    subscription: {
      status: "free_trial",
      trialStartedAt: new Date().toISOString()
    },
    favorites: []
  };

  customers.set(customer.id, customer);

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    },
    token: createSession(customer.id)
  });
});

app.post("/api/account/login", (req, res) => {
  const email =
    String(req.body?.email || "")
      .trim()
      .toLowerCase();

  const password = req.body?.password;

  const customer =
    [...customers.values()].find(
      customer => customer.email === email
    );

  if (!customer || customer.password !== password) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    },
    token: createSession(customer.id)
  });
});

app.get("/api/account/me", (req, res) => {
  const customer = getCustomer(req);

  if (!customer) {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email
    }
  });
});

app.post("/api/account/logout", (req, res) => {
  const authorization = req.headers.authorization || "";

  if (authorization.startsWith("Bearer ")) {
    sessions.delete(authorization.slice(7));
  }

  res.json({
    ok: true
  });
});

/*
==================================================
SUBSCRIPTION
==================================================
*/

app.get(
  "/api/subscription",
  requireCustomer,
  (req, res) => {
    res.json({
      subscription: req.customer.subscription
    });
  }
);

app.post(
  "/api/subscription/start-trial",
  requireCustomer,
  (req, res) => {
    req.customer.subscription = {
      status: "free_trial",
      trialStartedAt:
        req.customer.subscription.trialStartedAt ||
        new Date().toISOString()
    };

    res.json({
      ok: true,
      message: "Your one-month free trial is ready.",
      subscription: req.customer.subscription
    });
  }
);

app.post(
  "/api/subscription/start-checkout",
  requireCustomer,
  (req, res) => {
    res.status(501).json({
      error:
        "Stripe checkout is not connected yet."
    });
  }
);

/*
==================================================
RECIPES
==================================================
*/

app.get("/api/recipes", (req, res) => {
  res.json({
    recipes: Object.values(RECIPES)
  });
});

app.get("/api/recipes/:id", (req, res) => {
  const recipe = RECIPES[req.params.id];

  if (!recipe) {
    return res.status(404).json({
      error: "Recipe not found."
    });
  }

  res.json({
    recipe
  });
});

/*
==================================================
FAVORITES
==================================================
*/

app.get(
  "/api/favorites",
  requireCustomer,
  (req, res) => {
    res.json({
      favorites: req.customer.favorites || []
    });
  }
);

app.post(
  "/api/favorites/:id",
  requireCustomer,
  (req, res) => {
    if (!req.customer.favorites.includes(req.params.id)) {
      req.customer.favorites.push(req.params.id);
    }

    res.json({
      favorites: req.customer.favorites
    });
  }
);

/*
==================================================
KROGER OAUTH
==================================================
*/

function startKrogerLogin(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send(
      "Kroger API credentials are not configured in Vercel."
    );
  }

  const state =
    crypto.randomBytes(24).toString("hex");

  oauthStates.set(state, {
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope:
      "cart.basic:write product.compact profile.compact",
    state
  });

  res.redirect(
    `${KROGER_OAUTH}/authorize?${params.toString()}`
  );
}

app.get("/auth/kroger", startKrogerLogin);
app.get("/login", startKrogerLogin);

app.get("/callback", async (req, res) => {
  const {
    code,
    state,
    error
  } = req.query;

  if (error) {
    return res
      .status(400)
      .send(`Kroger login failed: ${error}`);
  }

  if (!code) {
    return res
      .status(400)
      .send(
        "Kroger did not return an authorization code."
      );
  }

  if (
    state &&
    !oauthStates.has(state)
  ) {
    return res
      .status(400)
      .send("Invalid OAuth state.");
  }

  if (state) {
    oauthStates.delete(state);
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI
    });

    const response = await fetch(
      `${KROGER_OAUTH}/token`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Kroger OAuth error:", data);

      return res
        .status(500)
        .send(
          "Kroger authorization failed."
        );
    }

    krogerToken = data.access_token;
    krogerRefreshToken =
      data.refresh_token || null;

    krogerTokenExpiresAt =
      Date.now() +
      Number(data.expires_in || 1800) * 1000;

    res.redirect("/");
  } catch (error) {
    console.error(
      "Kroger callback error:",
      error
    );

    res
      .status(500)
      .send(
        "Something went wrong connecting Kroger."
      );
  }
});

/*
==================================================
KROGER STATUS
==================================================
*/

app.get(
  "/api/kroger-status",
  async (req, res) => {
    try {
      await getKrogerAccessToken();

      res.json({
        connected: true
      });
    } catch {
      res.json({
        connected: false
      });
    }
  }
);

/*
==================================================
KROGER STORES
==================================================
*/

app.get("/api/stores", async (req, res) => {
  const zip =
    String(req.query.zip || "").trim();

  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({
      error:
        "Enter a valid 5-digit ZIP code."
    });
  }

  try {
    const token =
      await getKrogerAccessToken();

    const params = new URLSearchParams({
      "filter.zipCode.near": zip,
      "filter.limit": "20"
    });

    const response = await fetch(
      `${KROGER_API}/locations?${params}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error_description ||
          data.message ||
          "Kroger store search failed."
      });
    }

    res.json({
      stores: (data.data || []).map(store => ({
        id: store.locationId,
        name: store.name || "Kroger",
        address:
          store.address?.addressLine1 || "",
        city:
          store.address?.city || "",
        state:
          store.address?.state || "",
        zip:
          store.address?.zipCode || ""
      }))
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/*
==================================================
KROGER PRODUCTS
==================================================
*/

app.get("/api/products", async (req, res) => {
  const term =
    String(req.query.term || "").trim();

  const locationId =
    String(
      req.query.locationId ||
      req.query.store ||
      ""
    ).trim();

  if (!term || !locationId) {
    return res.status(400).json({
      error:
        "A product search term and Kroger location ID are required."
    });
  }

  try {
    const token =
      await getKrogerAccessToken();

    const params = new URLSearchParams({
      "filter.term": term,
      "filter.locationId": locationId,
      "filter.limit":
        String(req.query.limit || 10)
    });

    const response = await fetch(
      `${KROGER_API}/products?${params}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error_description ||
          data.message ||
          "Product search failed."
      });
    }

    res.json({
      products: data.data || []
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/*
==================================================
PRODUCT CLEANUP
==================================================
*/

function cleanProduct(product) {
  const item =
    product.items?.[0];

  const image =
    product.images?.[0];

  const sizes =
    image?.sizes || [];

  const preferred =
    sizes.find(
      size => size.size === "large"
    ) ||
    sizes[sizes.length - 1];

  return {
    upc: product.upc,
    productId:
      product.productId,
    description:
      product.description ||
      "Product",
    brand:
      product.brand || "",
    size:
      item?.size || "",
    price:
      item?.price?.regular ?? null,
    salePrice:
      item?.price?.promo ?? null,
    image:
      preferred?.url || null
  };
}

/*
==================================================
RECIPE PRODUCT SEARCH
==================================================
*/

app.get(
  "/api/recipe-search",
  async (req, res) => {
    const store =
      String(
        req.query.store ||
        req.query.locationId ||
        ""
      ).trim();

    const terms =
      String(
        req.query.ingredients || ""
      )
        .split(",")
        .map(term => term.trim())
        .filter(Boolean);

    if (!store) {
      return res.status(400).json({
        error:
          "A Kroger store/location ID is required."
      });
    }

    if (!terms.length) {
      return res.status(400).json({
        error:
          "No ingredients were provided."
      });
    }

    try {
      const token =
        await getKrogerAccessToken();

      const results = [];

      for (const term of terms) {
        const params =
          new URLSearchParams({
            "filter.term": term,
            "filter.locationId": store,
            "filter.limit": "10"
          });

        const response =
          await fetch(
            `${KROGER_API}/products?${params}`,
            {
              headers: {
                Authorization:
                  `Bearer ${token}`,
                Accept:
                  "application/json"
              }
            }
          );

        const data =
          await response.json();

        results.push({
          ingredient: term,
          search: term,
          products:
            response.ok
              ? (data.data || []).map(
                  cleanProduct
                )
              : []
        });
      }

      res.json({
        ingredients: results
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/*
==================================================
KROGER CART
==================================================
*/

app.post(
  "/api/cart/add",
  async (req, res) => {
    const items =
      Array.isArray(req.body?.items)
        ? req.body.items
        : [];

    if (!items.length) {
      return