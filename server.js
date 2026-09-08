require("dotenv").config();
const express=require("express");
const cors=require("cors");
const crypto=require("crypto");
const app=express();
const PORT=process.env.PORT||3000;
const KROGER_API="https://api.kroger.com/v1";
const KROGER_OAUTH="https://api.kroger.com/v1/connect/oauth2";
const CLIENT_ID=process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET=process.env.KROGER_CLIENT_SECRET;
const REDIRECT_URI=process.env.KROGER_REDIRECT_URI||"http://localhost:3000/callback";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

const sessions=new Map(),customers=new Map(),oauthStates=new Map();
let nextCustomerId=1,krogerToken=null,krogerRefreshToken=null,krogerTokenExpiresAt=0;

const RECIPES={
 spaghetti:{id:"spaghetti",name:"Spaghetti & Meatballs",category:"Fan Favorite",baseServings:2,ingredients:[["Spaghetti",8,"oz","spaghetti"],["Ground Beef",1,"lb","ground beef"],["Tomato Sauce",15,"oz","tomato sauce"],["Yellow Onion",.5,"lb","yellow onion"],["Garlic",2,"cloves","garlic"]]},
 chicken:{id:"chicken",name:"Lemon Herb Chicken",category:"Chicken",baseServings:2,ingredients:[["Chicken Breast",1,"lb","chicken breast"],["Lemon",2,"each","lemon"],["Garlic",3,"cloves","garlic"],["Olive Oil",2,"tbsp","olive oil"],["Fresh Parsley",1,"bunch","fresh parsley"]]},
 grilledChicken:{id:"grilledChicken",name:"Smoky Grilled Chicken",category:"Grilled Chicken",baseServings:2,ingredients:[["Chicken Breast",1.5,"lb","chicken breast"],["Lemon",1,"each","lemon"],["Garlic",3,"cloves","garlic"],["BBQ Sauce",.5,"bottle","bbq sauce"]]},
 bbqChicken:{id:"bbqChicken",name:"BBQ Chicken Dinner",category:"Grilled Chicken",baseServings:2,ingredients:[["Chicken Thighs",2,"lb","chicken thighs"],["BBQ Sauce",1,"bottle","bbq sauce"],["Corn",4,"each","corn"],["Green Beans",1,"lb","green beans"]]},
 mexicanChicken:{id:"mexicanChicken",name:"Mexican Street Chicken",category:"Grilled Chicken",baseServings:2,ingredients:[["Chicken Breast",1.5,"lb","chicken breast"],["Lime",3,"each","lime"],["Corn Tortillas",8,"each","corn tortillas"],["Cotija Cheese",4,"oz","cotija cheese"]]},
 teriyakiChicken:{id:"teriyakiChicken",name:"Teriyaki Chicken",category:"Asian Chicken",baseServings:2,ingredients:[["Chicken Breast",1.5,"lb","chicken breast"],["Teriyaki Sauce",1,"bottle","teriyaki sauce"],["Broccoli",1,"lb","broccoli"],["White Rice",1,"lb","white rice"]]},
 beefBroccoli:{id:"beefBroccoli",name:"Beef & Broccoli",category:"Asian",baseServings:2,ingredients:[["Beef Steak",1,"lb","beef steak"],["Broccoli",1,"lb","broccoli"],["White Rice",1,"cup","white rice"],["Soy Sauce",3,"tbsp","soy sauce"],["Garlic",2,"cloves","garlic"]]},
 tacos:{id:"tacos",name:"Chicken Tacos",category:"Mexican",baseServings:2,ingredients:[["Chicken Breast",1,"lb","chicken breast"],["Flour Tortillas",8,"each","flour tortillas"],["Cheddar Cheese",1,"cup","shredded cheddar cheese"],["Tomatoes",2,"each","tomatoes"],["Lettuce",1,"head","lettuce"],["Sour Cream",1,"cup","sour cream"]]},
 pastaAlfredo:{id:"pastaAlfredo",name:"Creamy Garlic Alfredo",category:"Pasta",baseServings:2,ingredients:[["Penne Pasta",8,"oz","penne pasta"],["Heavy Cream",1,"pint","heavy cream"],["Parmesan Cheese",4,"oz","parmesan cheese"],["Garlic",3,"cloves","garlic"]]},
 brownies:{id:"brownies",name:"Fudgy Brownies",category:"Dessert",baseServings:8,ingredients:[["Brownie Mix",1,"box","brownie mix"],["Eggs",2,"each","eggs"],["Butter",.5,"lb","butter"]]}
};

function createSession(id){
  const t=crypto.randomBytes(32).toString("hex");
  sessions.set(t,{customerId:id});
  return t;
}
function customer(req){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer "))return null;
  const s=sessions.get(h.slice(7));
  return s?customers.get(s.customerId):null;
}
function requireCustomer(req,res,next){
  const c=customer(req);
  if(!c)return res.status(401).json({error:"You must be logged in."});
  req.customer=c;
  next();
}
function authHeader(){
  return "Basic "+Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

async function getKrogerAccessToken(){
  if(krogerToken&&Date.now()<krogerTokenExpiresAt-60000)return krogerToken;
  if(krogerRefreshToken){
    try{
      const body=new URLSearchParams({
        grant_type:"refresh_token",
        refresh_token:krogerRefreshToken
      });
      const r=await fetch(`${KROGER_OAUTH}/token`,{
        method:"POST",
        headers:{
          Authorization:authHeader(),
          "Content-Type":"application/x-www-form-urlencoded"
        },
        body
      });
      const d=await r.json();
      if(r.ok&&d.access_token){
        krogerToken=d.access_token;
        krogerRefreshToken=d.refresh_token||krogerRefreshToken;
        krogerTokenExpiresAt=Date.now()+Number(d.expires_in||1800)*1000;
        return krogerToken;
      }
    }catch{}
  }
  throw Error("Kroger is not connected.");
}

app.get("/api/health",(req,res)=>res.json({ok:true,app:"Better Cooking Co."}));

app.post("/api/account/register",(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||!email||!password)
    return res.status(400).json({error:"Name, email and password are required."});
  const e=String(email).trim().toLowerCase();
  for(const c of customers.values())
    if(c.email===e)return res.status(409).json({error:"An account with that email already exists."});
  const c={
    id:String(nextCustomerId++),
    name:String(name).trim(),
    email:e,
    password,
    subscription:{status:"free_trial",trialStartedAt:new Date().toISOString()},
    favorites:[]
  };
  customers.set(c.id,c);
  res.json({
    customer:{id:c.id,name:c.name,email:c.email},
    token:createSession(c.id)
  });
});

app.post("/api/account/login",(req,res)=>{
  const e=String(req.body?.email||"").trim().toLowerCase();
  const p=req.body?.password;
  const c=[...customers.values()].find(x=>x.email===e);
  if(!c||c.password!==p)
    return res.status(401).json({error:"Incorrect email or password."});
  res.json({
    customer:{id:c.id,name:c.name,email:c.email},
    token:createSession(c.id)
  });
});

app.get("/api/account/me",(req,res)=>{
  const c=customer(req);
  if(!c)return res.json({loggedIn:false});
  res.json({
    loggedIn:true,
    customer:{id:c.id,name:c.name,email:c.email}
  });
});

app.post("/api/account/logout",(req,res)=>{
  const h=req.headers.authorization||"";
  if(h.startsWith("Bearer "))sessions.delete(h.slice(7));
  res.json({ok:true});
});

app.get("/api/subscription",requireCustomer,(req,res)=>
  res.json({subscription:req.customer.subscription})
);

app.post("/api/subscription/start-trial",requireCustomer,(req,res)=>{
  req.customer.subscription={
    status:"free_trial",
    trialStartedAt:req.customer.subscription.trialStartedAt||new Date().toISOString()
  };
  res.json({
    ok:true,
    message:"Your one-month free trial is ready.",
    subscription:req.customer.subscription
  });
});

app.post("/api/subscription/start-checkout",requireCustomer,(req,res)=>
  res.status(501).json({
    error:"Stripe checkout is not connected yet. The subscription structure is ready for it."
  })
);

app.get("/api/recipes",(req,res)=>
  res.json({recipes:Object.values(RECIPES)})
);

app.get("/api/recipes/:id",(req,res)=>
  RECIPES[req.params.id]
    ?res.json({recipe:RECIPES[req.params.id]})
    :res.status(404).json({error:"Recipe not found."})
);

app.get("/api/favorites",requireCustomer,(req,res)=>
  res.json({favorites:req.customer.favorites||[]})
);

app.post("/api/favorites/:id",requireCustomer,(req,res)=>{
  if(!req.customer.favorites.includes(req.params.id))
    req.customer.favorites.push(req.params.id);
  res.json({favorites:req.customer.favorites});
});

function startKrogerLogin(req,res){
  if(!CLIENT_ID||!CLIENT_SECRET)
    return res.status(500).send("Kroger API credentials are missing. Check .env.");
  const state=crypto.randomBytes(24).toString("hex");
  oauthStates.set(state,{createdAt:Date.now()});
  const p=new URLSearchParams({
    client_id:CLIENT_ID,
    redirect_uri:REDIRECT_URI,
    response_type:"code",
    scope:"cart.basic:write product.compact profile.compact",
    state
  });
  res.redirect(`${KROGER_OAUTH}/authorize?${p}`);
}

app.get("/auth/kroger",startKrogerLogin);
app.get("/login",startKrogerLogin);

app.get("/callback",async(req,res)=>{
  const {code,state,error}=req.query;
  if(error)return res.status(400).send(`Kroger login failed: ${error}`);
  if(!code)return res.status(400).send("Kroger did not return an authorization code.");
  if(state&&!oauthStates.has(state))
    return res.status(400).send("Invalid OAuth state.");
  if(state)oauthStates.delete(state);

  try{
    const body=new URLSearchParams({
      grant_type:"authorization_code",
      code,
      redirect_uri:REDIRECT_URI
    });
    const r=await fetch(`${KROGER_OAUTH}/token`,{
      method:"POST",
      headers:{
        Authorization:authHeader(),
        "Content-Type":"application/x-www-form-urlencoded"
      },
      body
    });
    const d=await r.json();
    if(!r.ok)return res.status(500).send("Kroger authorization failed. Check the terminal.");
    krogerToken=d.access_token;
    krogerRefreshToken=d.refresh_token||null;
    krogerTokenExpiresAt=Date.now()+Number(d.expires_in||1800)*1000;
    res.redirect("/");
  }catch(e){
    console.error(e);
    res.status(500).send("Something went wrong connecting Kroger.");
  }
});

app.get("/api/kroger-status",async(req,res)=>{
  try{
    await getKrogerAccessToken();
    res.json({connected:true});
  }catch{
    res.json({connected:false});
  }
});

app.get("/api/stores",async(req,res)=>{
  const zip=String(req.query.zip||"").trim();
  if(!/^\d{5}$/.test(zip))
    return res.status(400).json({error:"Enter a valid 5-digit ZIP code."});

  try{
    const token=await getKrogerAccessToken();
    const p=new URLSearchParams({
      "filter.zipCode.near":zip,
      "filter.limit":"20"
    });
    const r=await fetch(`${KROGER_API}/locations?${p}`,{
      headers:{
        Authorization:`Bearer ${token}`,
        Accept:"application/json"
      }
    });
    const d=await r.json();
    if(!r.ok)
      return res.status(r.status).json({
        error:d.error_description||d.message||"Kroger store search failed."
      });

    res.json({
      stores:(d.data||[]).map(s=>({
        id:s.locationId,
        name:s.name||"Kroger",
        address:s.address?.addressLine1||"",
        city:s.address?.city||"",
        state:s.address?.state||"",
        zip:s.address?.zipCode||""
      }))
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get("/api/products",async(req,res)=>{
  const term=String(req.query.term||"").trim();
  const locationId=String(req.query.locationId||req.query.store||"").trim();
  if(!term||!locationId)
    return res.status(400).json({
      error:"A product search term and Kroger location ID are required."
    });

  try{
    const token=await getKrogerAccessToken();
    const p=new URLSearchParams({
      "filter.term":term,
      "filter.locationId":locationId,
      "filter.limit":String(req.query.limit||10)
    });
    const r=await fetch(`${KROGER_API}/products?${p}`,{
      headers:{
        Authorization:`Bearer ${token}`,
        Accept:"application/json"
      }
    });
    const d=await r.json();
    if(!r.ok)
      return res.status(r.status).json({
        error:d.error_description||d.message||"Product search failed."
      });
    res.json({products:d.data||[]});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

function cleanProduct(p){
  const item=p.items?.[0];
  const image=p.images?.[0];
  const sizes=image?.sizes||[];
  const preferred=sizes.find(x=>x.size==="large")||sizes[sizes.length-1];
  return {
    upc:p.upc,
    productId:p.productId,
    description:p.description||"Product",
    brand:p.brand||"",
    size:item?.size||"",
    price:item?.price?.regular??null,
    salePrice:item?.price?.promo??null,
    image:preferred?.url||null
  };
}

app.get("/api/recipe-search",async(req,res)=>{
  const store=String(req.query.store||req.query.locationId||"").trim();
  const terms=String(req.query.ingredients||"")
    .split(",")
    .map(x=>x.trim())
    .filter(Boolean);

  if(!store)
    return res.status(400).json({error:"A Kroger store/location ID is required."});
  if(!terms.length)
    return res.status(400).json({error:"No ingredients were provided."});

  try{
    const token=await getKrogerAccessToken();
    const out=[];
    for(const term of terms){
      const p=new URLSearchParams({
        "filter.term":term,
        "filter.locationId":store,
        "filter.limit":"10"
      });
      const r=await fetch(`${KROGER_API}/products?${p}`,{
        headers:{
          Authorization:`Bearer ${token}`,
          Accept:"application/json"
        }
      });
      const d=await r.json();
      out.push({
        ingredient:term,
        search:term,
        products:r.ok?(d.data||[]).map(cleanProduct):[]
      });
    }
    res.json({ingredients:out});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post("/api/cart/add",async(req,res)=>{
  const items=Array.isArray(req.body?.items)?req.body.items:[];
  if(!items.length)
    return res.status(400).json({error:"Cart items are required."});

  try{
    const token=await getKrogerAccessToken();
    const body={
      items:items
        .filter(x=>x.upc)
        .map(x=>({
          quantity:Number(x.quantity)||1,
          upc:String(x.upc),
          modality:x.modality||"PICKUP"
        }))
    };
    const r=await fetch(`${KROGER_API}/cart/add`,{
      method:"PUT",
      headers:{
        Authorization:`Bearer ${token}`,
        "Content-Type":"application/json",
        Accept:"application/json"
      },
      body:JSON.stringify(body)
    });
    if(!r.ok)
      return res.status(r.status).json({
        error:"Kroger could not add the items to the cart.",
        details:await r.text()
      });
    res.json({
      success:true,
      itemsAdded:body.items.length,
      cartUrl:"https://www.kroger.com/shopping/cart"
    });
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

app.get("/api/admin/recipes",(req,res)=>
  res.json({recipes:Object.values(RECIPES)})
);

app.put("/api/admin/recipes/:id",(req,res)=>{
  if(!RECIPES[req.params.id])
    return res.status(404).json({error:"Recipe not found."});
  Object.assign(RECIPES[req.params.id],req.body||{});
  res.json({recipe:RECIPES[req.params.id]});
});

app.post("/api/admin/recipes",(req,res)=>{
  if(!req.body?.id||!req.body?.name)
    return res.status(400).json({error:"Recipe id and name are required."});
  RECIPES[req.body.id]=req.body;
  res.json({recipe:RECIPES[req.body.id]});
});

app.delete("/api/admin/recipes/:id",(req,res)=>{
  if(!RECIPES[req.params.id])
    return res.status(404).json({error:"Recipe not found."});
  delete RECIPES[req.params.id];
  res.json({ok:true});
});

app.use(express.static(__dirname));

// Run normally on your computer, but export the Express app for Vercel.
if(require.main===module){
  app.listen(PORT,()=>console.log(
    `Cook Better Co. running at http://localhost:${PORT}`
  ));
}

module.exports=app;
