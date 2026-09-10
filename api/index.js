const crypto = require("crypto");
const API = "https://api.kroger.com/v1";
const TOKEN = `${API}/connect/oauth2/token`;
const AUTHORIZE = `${API}/connect/oauth2/authorize`;
const SESSION = "cb_kroger_session";
const STATE = "cb_kroger_state";

const env = n => { if (!process.env[n]) throw new Error(`Missing environment variable: ${n}`); return process.env[n]; };
const json = (res, status, body, headers={}) => { res.statusCode=status; for (const [k,v] of Object.entries(headers)) res.setHeader(k,v); res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const redirect = (res,url,headers={}) => { res.statusCode=302; res.setHeader("Location",url); for(const [k,v] of Object.entries(headers)) res.setHeader(k,v); res.end(); };
function parseCookies(req){ const out={}; for(const part of (req.headers.cookie||"").split(";")){ const i=part.indexOf("="); if(i<0) continue; out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()); } return out; }
function cookie(name,value,maxAge){ return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`; }
function clear(name){ return cookie(name,"",0); }
function key(){ return crypto.createHash("sha256").update(env("SESSION_SECRET")).digest(); }
function encrypt(obj){ const iv=crypto.randomBytes(12), c=crypto.createCipheriv("aes-256-gcm",key(),iv); const data=Buffer.concat([c.update(JSON.stringify(obj),"utf8"),c.final()]); return Buffer.concat([iv,c.getAuthTag(),data]).toString("base64url"); }
function decrypt(value){ try{ const b=Buffer.from(value,"base64url"),d=crypto.createDecipheriv("aes-256-gcm",key(),b.subarray(0,12)); d.setAuthTag(b.subarray(12,28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString("utf8")); }catch{return null} }
function redirectUri(req){ return process.env.KROGER_REDIRECT_URI || `https://${req.headers.host}/api/auth/kroger/callback`; }
async function clientToken(){
  const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64");
  const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"client_credentials",scope:"product.compact"})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Kroger client token failed (${r.status}): ${d.error_description||d.error||d.reason||"Unknown error"}`);
  if(!d.access_token) throw new Error("Kroger token response did not include an access token.");
  return d.access_token;
}
async function userSession(req,res){
  const s=decrypt(parseCookies(req)[SESSION]); if(!s) return null;
  if(s.expires_at && Date.now()>=s.expires_at){
    if(!s.refresh_token){res.setHeader("Set-Cookie",clear(SESSION));return null;}
    const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64");
    const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:s.refresh_token})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.access_token){res.setHeader("Set-Cookie",clear(SESSION));return null;}
    s={...s,access_token:d.access_token,refresh_token:d.refresh_token||s.refresh_token,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};
    res.setHeader("Set-Cookie",cookie(SESSION,encrypt(s),2592000));
  }
  return s;
}
async function body(req){ if(req.body&&typeof req.body==='object') return req.body; let raw=""; for await(const c of req) raw+=c; try{return JSON.parse(raw||"{}")}catch{return {}} }
function route(req){ return new URL(req.url,`https://${req.headers.host}`).pathname.replace(/^\/api\/?/,"").replace(/\/$/,""); }

async function stores(req,res){
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});
  const u=new URL(req.url,`https://${req.headers.host}`),zip=u.searchParams.get("zip")||"";
  if(!/^\d{5}$/.test(zip)) return json(res,400,{error:"A valid 5-digit ZIP code is required."});
  const token=await clientToken(),p=new URLSearchParams({"filter.zipCode.near":zip,"filter.radiusInMiles":u.searchParams.get("radius")||"15","filter.limit":u.searchParams.get("limit")||"10"});
  const r=await fetch(`${API}/locations?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}}),d=await r.json().catch(()=>({}));
  if(!r.ok) return json(res,r.status,{error:d.errors||d.error_description||"Kroger locations request failed."});
  return json(res,200,{data:(d.data||[]).map(x=>({id:x.locationId,name:x.name,chain:x.chain,address:x.address,modalities:x.modality||x.modalities||[]}))});
}
async function products(req,res){
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});
  const u=new URL(req.url,`https://${req.headers.host}`),term=(u.searchParams.get("term")||"").trim(),locationId=(u.searchParams.get("locationId")||"").trim();
  if(!term||!locationId) return json(res,400,{error:"term and locationId are required."});
  const token=await clientToken(),p=new URLSearchParams({"filter.term":term,"filter.locationId":locationId,"filter.limit":u.searchParams.get("limit")||"8"});
  const r=await fetch(`${API}/products?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}}),d=await r.json().catch(()=>({}));
  if(!r.ok) return json(res,r.status,{error:d.errors||d.error_description||"Kroger products request failed."});
  const out=(d.data||[]).map(x=>{const item=(x.items||[]).find(i=>i.price)||x.items?.[0]||{},price=item.price?.regular??item.price?.promo??null,f=item.fulfillment||{},modality=f.csp?"csp":f.ais?"ais":f.dth?"dth":f.sth?"sth":"ais",im=(x.images||[]).find(i=>i.perspective==="front")||x.images?.[0];return {upc:x.upc,description:x.description||x.productDescription||"",brand:x.brand||"",price,image:im?.sizes?.[0]?.url||im?.url||"",modality};}).filter(x=>x.upc);
  return json(res,200,{data:out});
}
async function krogerAuth(req,res){
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});
  const state=crypto.randomBytes(24).toString("hex"),p=new URLSearchParams({scope:process.env.KROGER_SCOPES||"cart.basic:write product.compact profile.compact",response_type:"code",client_id:env("KROGER_CLIENT_ID"),redirect_uri:redirectUri(req),state});
  return redirect(res,`${AUTHORIZE}?${p}`,{"Set-Cookie":cookie(STATE,state,600)});
}
async function callback(req,res){
  const u=new URL(req.url,`https://${req.headers.host}`),c=parseCookies(req),code=u.searchParams.get("code"),state=u.searchParams.get("state"),error=u.searchParams.get("error");
  if(error) return redirect(res,`/?kroger=error&message=${encodeURIComponent(error)}`,{"Set-Cookie":clear(STATE)});
  if(!code||!state||state!==c[STATE]) return redirect(res,"/?kroger=error&message=Invalid%20OAuth%20state",{"Set-Cookie":clear(STATE)});
  const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64");
  const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirectUri(req)})}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token) return redirect(res,`/?kroger=error&message=${encodeURIComponent(d.error_description||d.error||"Kroger authorization failed")}`,{"Set-Cookie":clear(STATE)});
  const s={access_token:d.access_token,refresh_token:d.refresh_token||null,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};
  return redirect(res,"/?kroger=connected",{"Set-Cookie":[cookie(SESSION,encrypt(s),2592000),clear(STATE)]});
}
async function cart(req,res){
  if(req.method!=="PUT") return json(res,405,{error:"Method not allowed."});
  const s=await userSession(req,res); if(!s) return json(res,401,{error:"Connect your Kroger account first."});
  const b=await body(req),items=(Array.isArray(b.items)?b.items:[]).map(x=>({quantity:Math.max(1,Number(x.quantity||1)),upc:String(x.upc||""),modality:String(x.modality||"ais")})).filter(x=>/^\d{8,14}$/.test(x.upc));
  if(!items.length) return json(res,400,{error:"No valid UPCs supplied."});
  const r=await fetch(`${API}/cart/add`,{method:"PUT",headers:{Authorization:`Bearer ${s.access_token}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({items})}),text=await r.text();
  if(!r.ok){let d={};try{d=JSON.parse(text)}catch{}return json(res,r.status,{error:d.errors||d.error_description||d.error||"Kroger cart request failed."});}
  return json(res,200,{ok:true,count:items.length,cartUrl:"https://www.kroger.com/cart"});
}

module.exports=async function(req,res){
  try{
    const r=route(req);
    if(r==="stores") return stores(req,res);
    if(r==="products") return products(req,res);
    if(r==="auth/kroger") return krogerAuth(req,res);
    if(r==="auth/kroger/callback") return callback(req,res);
    if(r==="auth/status"){ if(req.method!=="GET") return json(res,405,{error:"Method not allowed."}); return json(res,200,{connected:!!(await userSession(req,res))}); }
    if(r==="auth/logout"){ if(req.method!=="POST") return json(res,405,{error:"Method not allowed."}); return json(res,200,{ok:true},{"Set-Cookie":clear(SESSION)}); }
    if(r==="cart/add") return cart(req,res);
    return json(res,404,{error:"API route not found."});
  }catch(e){ console.error(e); return json(res,500,{error:e.message||"Server error."}); }
};
