const crypto = require("crypto");
const API = "https://api.kroger.com/v1";
const TOKEN = `${API}/connect/oauth2/token`;
const AUTHORIZE = `${API}/connect/oauth2/authorize`;
const KROGER_SESSION = "cb_kroger_session";
const KROGER_STATE = "cb_kroger_state";
const ACCOUNT_SESSION = "cb_account_session";
const ACCOUNT_STATE = "cb_account_state";

const env = n => { if (!process.env[n]) throw new Error(`Missing environment variable: ${n}`); return process.env[n]; };
const json = (res,status,body,headers={}) => { res.statusCode=status; for(const [k,v] of Object.entries(headers))res.setHeader(k,v); res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
const redirect = (res,url,headers={}) => { res.statusCode=302; res.setHeader("Location",url); for(const [k,v] of Object.entries(headers))res.setHeader(k,v); res.end(); };
function parseCookies(req){const out={};for(const part of (req.headers.cookie||"").split(";")){const i=part.indexOf("=");if(i<0)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`}
function clearCookie(name){return cookie(name,"",0)}
function hashKey(secret){return crypto.createHash("sha256").update(secret).digest()}
function seal(obj,secretName="SESSION_SECRET"){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",hashKey(env(secretName)),iv);const data=Buffer.concat([c.update(JSON.stringify(obj),"utf8"),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString("base64url")}
function unseal(value,secretName="SESSION_SECRET"){try{const b=Buffer.from(value,"base64url"),d=crypto.createDecipheriv("aes-256-gcm",hashKey(env(secretName)),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString("utf8"))}catch{return null}}
function redirectUri(req){return process.env.KROGER_REDIRECT_URI||`https://${req.headers.host}/api/auth/kroger/callback`}
function route(req){return new URL(req.url,`https://${req.headers.host}`).pathname.replace(/^\/api\/?/,"").replace(/\/$/,"")}
async function readRawBody(req){if(Buffer.isBuffer(req.rawBody))return req.rawBody;if(typeof req.rawBody==='string')return Buffer.from(req.rawBody);if(Buffer.isBuffer(req.body))return req.body;const chunks=[];for await(const c of req)chunks.push(Buffer.from(c));return Buffer.concat(chunks)}
async function body(req){if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;const raw=await readRawBody(req);try{return JSON.parse(raw.toString('utf8')||'{}')}catch{return {}}}
function errorText(v){if(!v)return "Request failed.";if(typeof v==="string")return v;if(Array.isArray(v))return v.map(errorText).filter(Boolean).join("; ")||"Request failed.";if(v.message)return String(v.message);if(v.error_description)return String(v.error_description);if(v.error)return typeof v.error==="string"?v.error:errorText(v.error);if(v.reason)return String(v.reason);try{return JSON.stringify(v)}catch{return "Request failed."}}

async function krogerClientToken(){const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64");const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"client_credentials",scope:"product.compact"})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(`Kroger client token failed (${r.status}): ${errorText(d)}`);return d.access_token}
async function krogerUserSession(req,res){const s=unseal(parseCookies(req)[KROGER_SESSION]);if(!s)return null;if(s.expires_at&&Date.now()>=s.expires_at){if(!s.refresh_token){res.setHeader("Set-Cookie",clearCookie(KROGER_SESSION));return null}const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64");const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:s.refresh_token})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token){res.setHeader("Set-Cookie",clearCookie(KROGER_SESSION));return null}s={...s,access_token:d.access_token,refresh_token:d.refresh_token||s.refresh_token,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};res.setHeader("Set-Cookie",cookie(KROGER_SESSION,seal(s),2592000))}return s}

async function stores(req,res){if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});const u=new URL(req.url,`https://${req.headers.host}`),zip=u.searchParams.get("zip")||"";if(!/^\d{5}$/.test(zip))return json(res,400,{error:"A valid 5-digit ZIP code is required."});const token=await krogerClientToken(),p=new URLSearchParams({"filter.zipCode.near":zip,"filter.radiusInMiles":u.searchParams.get("radius")||"15","filter.limit":u.searchParams.get("limit")||"10"});const r=await fetch(`${API}/locations?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}}),d=await r.json().catch(()=>({}));if(!r.ok)return json(res,r.status,{error:errorText(d.errors||d)});return json(res,200,{data:(d.data||[]).map(x=>({id:x.locationId,name:x.name,chain:x.chain,address:x.address,distance:x.distance??x.location?.distance??null,modalities:x.modality||x.modalities||[]}))})}
async function products(req,res){if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});const u=new URL(req.url,`https://${req.headers.host}`),term=(u.searchParams.get("term")||"").trim(),locationId=(u.searchParams.get("locationId")||"").trim();if(!term||!locationId)return json(res,400,{error:"term and locationId are required."});const token=await krogerClientToken(),p=new URLSearchParams({"filter.term":term,"filter.locationId":locationId,"filter.limit":u.searchParams.get("limit")||"8"});const r=await fetch(`${API}/products?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}}),d=await r.json().catch(()=>({}));if(!r.ok)return json(res,r.status,{error:errorText(d.errors||d)});const out=(d.data||[]).map(x=>{const items=x.items||[],priced=items.find(i=>Number(i.price?.regular)>0)||items.find(i=>Number(i.price?.promo)>0),item=priced||items.find(i=>i.price)||items[0]||{},price=Number(item.price?.regular)>0?Number(item.price.regular):Number(item.price?.promo)>0?Number(item.price.promo):null,ims=(x.images||[]),im=ims.find(i=>i.perspective==="front")||ims[0]||{},sizes=Array.isArray(im.sizes)?im.sizes:[im],image=(sizes.find(z=>z?.url)?.url)||"";return{upc:x.upc,description:x.description||x.productDescription||"",brand:x.brand||"",price,image,size:String(item.size||"").slice(0,60)}}).filter(x=>x.upc);return json(res,200,{data:out})}
async function krogerAuth(req,res){if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});const state=crypto.randomBytes(24).toString("hex"),p=new URLSearchParams({scope:process.env.KROGER_SCOPES||"cart.basic:write product.compact profile.compact",response_type:"code",client_id:env("KROGER_CLIENT_ID"),redirect_uri:redirectUri(req),state});return redirect(res,`${AUTHORIZE}?${p}`,{"Set-Cookie":cookie(KROGER_STATE,state,600)})}
async function krogerCallback(req,res){const u=new URL(req.url,`https://${req.headers.host}`),c=parseCookies(req),code=u.searchParams.get("code"),state=u.searchParams.get("state"),error=u.searchParams.get("error");if(error)return redirect(res,`/?kroger=error&message=${encodeURIComponent(error)}`,{"Set-Cookie":clearCookie(KROGER_STATE)});if(!code||!state||state!==c[KROGER_STATE])return redirect(res,"/?kroger=error&message=Invalid%20OAuth%20state",{"Set-Cookie":clearCookie(KROGER_STATE)});const basic=Buffer.from(`${env("KROGER_CLIENT_ID")}:${env("KROGER_CLIENT_SECRET")}`).toString("base64"),r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirectUri(req)})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)return redirect(res,`/?kroger=error&message=${encodeURIComponent(errorText(d))}`,{"Set-Cookie":clearCookie(KROGER_STATE)});const s={access_token:d.access_token,refresh_token:d.refresh_token||null,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};return redirect(res,"/?kroger=connected",{"Set-Cookie":[cookie(KROGER_SESSION,seal(s),2592000),clearCookie(KROGER_STATE)]})}
async function cart(req,res){if(req.method!=="PUT")return json(res,405,{error:"Method not allowed."});const s=await krogerUserSession(req,res);if(!s)return json(res,401,{error:"Connect your Kroger account first."});const b=await body(req),items=(Array.isArray(b.items)?b.items:[]).map(x=>({quantity:Math.max(1,Number(x.quantity||1)),upc:String(x.upc||""),modality:(String(x.modality||"PICKUP").toUpperCase()==="DELIVERY"?"DELIVERY":"PICKUP")})).filter(x=>/^\d{8,14}$/.test(x.upc));if(!items.length)return json(res,400,{error:"No valid UPCs supplied."});const r=await fetch(`${API}/cart/add`,{method:"PUT",headers:{Authorization:`Bearer ${s.access_token}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({items})}),text=await r.text();if(!r.ok){let d={};try{d=JSON.parse(text)}catch{}return json(res,r.status,{error:errorText(d.errors||d),status:r.status,details:d.errors||d})}return json(res,200,{ok:true,count:items.length,cartUrl:"https://www.kroger.com/cart"})}

function supaBase(){return env("SUPABASE_URL").replace(/\/$/,"")}
function supabaseSecretKey(){return process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||env("SUPABASE_SECRET_KEY")}
function supabasePublicKey(){return process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||env("SUPABASE_PUBLISHABLE_KEY")}
function supaHeaders(){const k=supabaseSecretKey();return{apikey:k,Authorization:`Bearer ${k}`,"Content-Type":"application/json"}}
async function supa(path,opts={}){const r=await fetch(`${supaBase()}${path}`,{...opts,headers:{...supaHeaders(),...(opts.headers||{})}});const text=await r.text();let d={};try{d=JSON.parse(text)}catch{d={raw:text}};if(!r.ok)throw new Error(errorText(d));return d}
async function supaAuth(path,opts={}){const r=await fetch(`${supaBase()}${path}`,{...opts,headers:{apikey:supabasePublicKey(),"Content-Type":"application/json",...(opts.headers||{})}});const text=await r.text();let d={};try{d=JSON.parse(text)}catch{d={raw:text}};return{ok:r.ok,status:r.status,data:d}}
function accountCookie(value){return cookie(ACCOUNT_SESSION,value,2592000)}
function accountSession(req){return unseal(parseCookies(req)[ACCOUNT_SESSION])}
async function accountUser(req,res){let s=accountSession(req);if(!s?.access_token)return null;let r=await fetch(`${supaBase()}/auth/v1/user`,{headers:{apikey:supabasePublicKey(),Authorization:`Bearer ${s.access_token}`}});if(!r.ok&&s.refresh_token){const refreshed=await supaAuth("/auth/v1/token?grant_type=refresh_token",{method:"POST",body:JSON.stringify({refresh_token:s.refresh_token})});if(refreshed.ok&&refreshed.data.access_token){s={access_token:refreshed.data.access_token,refresh_token:refreshed.data.refresh_token||s.refresh_token};res.setHeader("Set-Cookie",accountCookie(seal(s)));r=await fetch(`${supaBase()}/auth/v1/user`,{headers:{apikey:supabasePublicKey(),Authorization:`Bearer ${s.access_token}`}})}}if(!r.ok)return null;return await r.json().catch(()=>null)}
async function profileFor(userId){const rows=await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,{method:"GET"});return rows[0]||null}
async function ensureProfile(user,name,email){let p=await profileFor(user.id);if(!p){const rows=await supa("/rest/v1/profiles",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({id:user.id,name:name||user.user_metadata?.full_name||email?.split("@")[0]||"Cook",email:email||user.email,points:0,taste_preferences:[],shopping_style:"value",home_zip:null,usual_servings:2,dietary_preferences:[],cooking_level:"Beginner",tried_recipes:[],meals_cooked:0,role:"customer"})});p=rows[0]}return p}
function publicProfile(p){return{id:p.id,name:p.name,email:p.email,points:Number(p.points||0),taste_preferences:p.taste_preferences||[],shopping_style:p.shopping_style||"value",home_zip:p.home_zip||"",usual_servings:Number(p.usual_servings||2),dietary_preferences:p.dietary_preferences||[],equipment_preferences:p.equipment_preferences||[],kitchen_notes:p.kitchen_notes||"",cooking_level:p.cooking_level||"Beginner",tried_recipes:p.tried_recipes||[],meals_cooked:Number(p.meals_cooked||0),role:p.role||"customer",subscription_status:p.subscription_status||"free",preferred_store_id:p.preferred_store_id||"",preferred_store_name:p.preferred_store_name||"",preferred_store_address:p.preferred_store_address||null}}

function adminEmails(){return String(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)}
async function adminContext(req,res){const u=await accountUser(req,res);if(!u)return null;const p=await ensureProfile(u,u.user_metadata?.full_name,u.email);const email=String(u.email||'').toLowerCase();const role=String(p.role||'customer').toLowerCase();if(!['admin','manager'].includes(role)&&!adminEmails().includes(email))return null;return{user:u,profile:p,role:adminEmails().includes(email)?'admin':role}}
async function requireAdmin(req,res){const a=await adminContext(req,res);if(!a){json(res,403,{error:'Developer access is restricted to authorized accounts.'});return null}return a}
async function supaCount(path){const r=await fetch(`${supaBase()}${path}`,{method:'GET',headers:{...supaHeaders(),Prefer:'count=exact'}});const text=await r.text();if(!r.ok)throw new Error(errorText(text));const cr=r.headers.get('content-range')||'';const m=cr.match(/\/(\d+)$/);return m?Number(m[1]):Array.isArray(JSON.parse(text||'[]'))?JSON.parse(text||'[]').length:0}
async function readPaywallMode(){const rows=await supa('/rest/v1/site_settings?key=eq.paywall_mode&select=value').catch(()=>[]);if(["real","demo","off"].includes(rows?.[0]?.value))return rows[0].value;const legacy=await supa('/rest/v1/site_settings?key=eq.paywall_enabled&select=value').catch(()=>[]);return legacy?.[0]?.value?"real":"off"}
async function publicContent(req,res){if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});const [rows,mode,site]=await Promise.all([supa('/rest/v1/recipe_overrides?select=recipe_id,image_url,locked,video_url,content_json,updated_at'),readPaywallMode(),supa('/rest/v1/site_settings?key=eq.site_content&select=value').catch(()=>[])]);return json(res,200,{overrides:rows||[],paywallMode:mode,paywallEnabled:mode!=='off',stripeConfigured:!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.PREMIUM_CONTENT_SECURE==="true"),siteContent:site?.[0]?.value||{}})}
async function analyticsEvent(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
 const b=await body(req),event=String(b.event||'pageview').slice(0,40),visitorId=String(b.visitorId||'').slice(0,80),sessionId=String(b.sessionId||'').slice(0,80),path=String(b.path||'/').slice(0,180),recipeId=String(b.recipeId||'').slice(0,80);
 if(!visitorId)return json(res,400,{error:'visitorId is required.'});
 let isInternal=false;
 const u=await accountUser(req,res);
 if(u){const p=await profileFor(u.id);isInternal=['admin','manager'].includes(String(p?.role||'').toLowerCase())||adminEmails().includes(String(u.email||'').toLowerCase())}
 await supa('/rest/v1/site_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({event,visitor_id:visitorId,session_id:sessionId||null,path,recipe_id:recipeId||null,is_internal:isInternal})});
 return json(res,200,{ok:true});
}

async function publicTechniques(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
 const mode=await readPaywallMode(),u=await accountUser(req,res);
 // No Paywall means genuinely open access, including technique videos for signed-out visitors.
 if(mode!=='off'&&!u)return json(res,401,{error:'Sign in to access member Technique Videos.'});
 if(mode==='demo'||mode==='real'){
  const p=await profileFor(u.id),status=String(p?.subscription_status||'').toLowerCase();
  const unlocked=mode==='demo'?['demo','active'].includes(status):status==='active';
  if(!unlocked)return json(res,403,{error:mode==='demo'?'Complete the demo checkout to view Technique Videos.':'An active membership is required to view Technique Videos.'});
 }
 const rows=await supa('/rest/v1/site_settings?key=eq.technique_videos&select=value').catch(()=>[]);
 return json(res,200,{videos:Array.isArray(rows?.[0]?.value)?rows[0].value:[],paywallMode:mode});
}
async function adminTechniques(req,res){
 const a=await requireAdmin(req,res);if(!a)return;
 if(req.method==='GET'){const rows=await supa('/rest/v1/site_settings?key=eq.technique_videos&select=value').catch(()=>[]);return json(res,200,{videos:Array.isArray(rows?.[0]?.value)?rows[0].value:[]})}
 if(req.method==='POST'){
  const b=await body(req),videos=Array.isArray(b.videos)?b.videos.slice(0,100):[];
  const clean=[];
  for(const v of videos){const title=String(v.title||'').trim().slice(0,120),url=String(v.url||'').trim().slice(0,500);if(!title||!url)continue;if(!/^https?:\/\//i.test(url))return json(res,400,{error:'Each video needs a valid http or https URL.'});clean.push({id:String(v.id||crypto.randomUUID()),title,description:String(v.description||'').trim().slice(0,500),category:String(v.category||'General').trim().slice(0,60),url})}
  const rows=await supa('/rest/v1/site_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key:'technique_videos',value:clean,updated_at:new Date().toISOString()})});
  return json(res,200,{videos:Array.isArray(rows?.[0]?.value)?rows[0].value:clean});
 }
 return json(res,405,{error:'Method not allowed.'});
}

async function adminSettings(req,res){const a=await requireAdmin(req,res);if(!a)return;if(req.method==='GET'){const mode=await readPaywallMode();return json(res,200,{paywallMode:mode,paywallEnabled:mode!=='off',stripeConfigured:!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.PREMIUM_CONTENT_SECURE==="true"),role:a.role})}if(req.method==='POST'){const b=await body(req),mode=String(b.paywallMode||(b.paywallEnabled?'real':'off')).toLowerCase();if(!['real','demo','off'].includes(mode))return json(res,400,{error:'Choose real, demo, or off for the paywall mode.'});await supa('/rest/v1/site_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({key:'paywall_mode',value:mode,updated_at:new Date().toISOString()})});await supa('/rest/v1/site_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({key:'paywall_enabled',value:mode!=='off',updated_at:new Date().toISOString()})});return json(res,200,{paywallMode:mode,paywallEnabled:mode!=='off',stripeConfigured:!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.PREMIUM_CONTENT_SECURE==="true"),role:a.role})}return json(res,405,{error:'Method not allowed.'})}
async function adminSiteContent(req,res){
 const a=await requireAdmin(req,res);if(!a)return;
 if(req.method==='GET'){
  const rows=await supa('/rest/v1/site_settings?key=eq.site_content&select=value').catch(()=>[]);
  return json(res,200,{siteContent:rows?.[0]?.value||{},role:a.role});
 }
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
 const b=await body(req),source=b.siteContent&&typeof b.siteContent==='object'?b.siteContent:{},clean={};
 const textKeys=['heroEyebrow','heroTitle','heroHighlight','heroDescription','heroCta','recipesTitle','recipesDescription','spotlightTitle','spotlightDescription','footerTagline','feature1Title','feature1Text','feature2Title','feature2Text','feature3Title','feature3Text','feature4Title','feature4Text'];
 for(const k of textKeys)if(typeof source[k]==='string')clean[k]=source[k].trim().slice(0,700);
 for(const k of ['heroImage','logoImage','heroMediaUrl','logoAnimationUrl'])if(typeof source[k]==='string'){
  const v=source[k].trim();
  if(!v||/^https:\/\//i.test(v))clean[k]=v.slice(0,1200);
  else return json(res,400,{error:k+' must be an HTTPS image URL.'});
 }
 if(typeof source.heroMediaType==='string'&&['video','gif','image','none'].includes(source.heroMediaType))clean.heroMediaType=source.heroMediaType;
 for(const k of ['accentColor','orangeColor'])if(typeof source[k]==='string'&&/^#[0-9a-f]{6}$/i.test(source[k]))clean[k]=source[k];
 for(const k of ['showFeatureStrip','showPlanningStart','showSpotlightSection','showRecipeSection'])if(typeof source[k]==='boolean')clean[k]=source[k];
 const rows=await supa('/rest/v1/site_settings',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key:'site_content',value:clean,updated_at:new Date().toISOString()})});
 return json(res,200,{siteContent:rows?.[0]?.value||clean});
}
async function adminMediaUpload(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
 const a=await requireAdmin(req,res);if(!a)return;
 const b=await body(req),dataUrl=String(b.dataUrl||''),area=String(b.area||'site').toLowerCase();
 const match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
 if(!match)return json(res,400,{error:'Choose a JPG, PNG, or WebP image.'});
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length>2800000)return json(res,413,{error:'Image is too large. Try a smaller image (under 2.8 MB after compression).'});
 const mime=match[1].toLowerCase(),ext=mime==='image/jpeg'?'jpg':mime.split('/')[1],bucket='cook-better-assets';
 const check=await fetch(supaBase()+'/storage/v1/bucket/'+bucket,{headers:supaHeaders()});
 if(!check.ok){
  const create=await fetch(supaBase()+'/storage/v1/bucket',{method:'POST',headers:supaHeaders(),body:JSON.stringify({id:bucket,name:bucket,public:true,file_size_limit:3000000,allowed_mime_types:['image/jpeg','image/png','image/webp']})});
  if(!create.ok&&create.status!==409){const t=await create.text();throw new Error('Could not prepare image storage: '+t.slice(0,240));}
 }
 const safeArea=/^[a-z0-9_-]{1,32}$/.test(area)?area:'site';
 const path=safeArea+'/'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'.'+ext;
 const upload=await fetch(supaBase()+'/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{...supaHeaders(),'Content-Type':mime,'x-upsert':'true','Cache-Control':'3600'},body:bytes});
 if(!upload.ok){const t=await upload.text();throw new Error('Image upload failed: '+t.slice(0,320));}
 const url=supaBase()+'/storage/v1/object/public/'+bucket+'/'+path;
 return json(res,200,{url,path,bucket});
}

async function adminMediaSign(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
 const a=await requireAdmin(req,res);if(!a)return;
 const b=await body(req),mime=String(b.contentType||'').toLowerCase(),fileName=String(b.fileName||'').slice(0,180),area=String(b.area||'site').toLowerCase(),size=Math.max(0,Number(b.size)||0);
 const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'};
 if(!allowed[mime])return json(res,415,{error:'Supported uploads: JPG, PNG, WebP, GIF, MP4, and WebM.'});
 if(!fileName)return json(res,400,{error:'A file name is required.'});
 if(size>45000000)return json(res,413,{error:'Keep uploads under 45 MB.'});
 const safeArea=['site','recipes','branding'].includes(area)?area:'site';
 const safeName=fileName.replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-90)||'media';
 const path=safeArea+'/'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'-'+safeName;
 const bucket='cook-better-assets',segments=path.split('/').map(encodeURIComponent).join('/');
 const signUrl=supaBase()+'/storage/v1/object/upload/sign/'+bucket+'/'+segments;
 const sign=await fetch(signUrl,{method:'POST',headers:{...supaHeaders(),'x-upsert':'false'}});
 const raw=await sign.text();let signed={};try{signed=JSON.parse(raw)}catch{signed={message:raw}}
 if(!sign.ok||!signed.token)return json(res,502,{error:errorText(signed)||'Could not create a secure upload link.'});
 const uploadUrl=supaBase()+'/storage/v1/object/upload/sign/'+bucket+'/'+segments+'?token='+encodeURIComponent(signed.token);
 const publicUrl=supaBase()+'/storage/v1/object/public/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/');
 return json(res,200,{uploadUrl,publicUrl,path,bucket,contentType:mime});
}
async function rewardStatus(req,res){
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:'Sign in first.'});
 const p=await ensureProfile(u,u.user_metadata?.full_name,u.email),month=new Date().toISOString().slice(0,7);
 const rows=await supa('/rest/v1/reward_events?user_id=eq.'+encodeURIComponent(u.id)+'&action=eq.monthly&reference_id=eq.'+encodeURIComponent(month)+'&select=id&limit=1');
 return json(res,200,{month,monthlyClaimed:!!rows?.length,mealsCooked:Number(p.meals_cooked||0),points:Number(p.points||0)});
}

async function adminStats(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
 const a=await requireAdmin(req,res);if(!a)return;
 const u=new URL(req.url,`https://${req.headers.host}`),rangeRaw=Number(u.searchParams.get('range')||30),rangeDays=[7,30,90,365].includes(rangeRaw)?rangeRaw:30,since=new Date(Date.now()-rangeDays*86400000).toISOString();
 const [events,users,sales,pending]=await Promise.all([
  supa(`/rest/v1/site_events?created_at=gte.${encodeURIComponent(since)}&select=event,visitor_id,session_id,path,created_at,is_internal&order=created_at.desc&limit=10000`),
  supaCount('/rest/v1/profiles?select=id&limit=1'),
  supa(`/rest/v1/sales?status=eq.completed&created_at=gte.${encodeURIComponent(since)}&select=amount&limit=10000`).catch(()=>[]),
  supaCount('/rest/v1/pending_orders?status=eq.pending&select=id&limit=1')
 ]);
 const external=(events||[]).filter(x=>!x.is_internal),internal=(events||[]).filter(x=>!!x.is_internal),views=external.filter(x=>x.event==='pageview'),internalViews=internal.filter(x=>x.event==='pageview');
 const visitorSessions=new Map(),sessions=new Set();
 for(const row of external){if(row.visitor_id){if(!visitorSessions.has(row.visitor_id))visitorSessions.set(row.visitor_id,new Set());if(row.session_id){visitorSessions.get(row.visitor_id).add(row.session_id);sessions.add(row.session_id)}}}
 const repeatVisitors=[...visitorSessions.values()].filter(x=>x.size>1).length;
 const pageCounts=new Map();for(const row of views){const key=String(row.path||'/').split('?')[0].split('#')[0]||'/';pageCounts.set(key,(pageCounts.get(key)||0)+1)}
 const topPages=[...pageCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([path,count])=>({path,count}));
 const salesTotal=(sales||[]).reduce((n,x)=>n+Number(x.amount||0),0),uniqueVisitors=visitorSessions.size;
 return json(res,200,{role:a.role,stats:{rangeDays,pageViews:views.length,pageViews30d:views.length,uniqueVisitors,uniqueVisitors30d:uniqueVisitors,sessions:sessions.size,repeatVisitors,internalPageViews:internalViews.length,users,salesTotal,pendingOrders:pending,topPages}});
}
async function adminReviews(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
 const a=await requireAdmin(req,res);if(!a)return;
 const rows=await supa('/rest/v1/recipe_ratings?select=id,recipe_id,rating,review,user_id,created_at,updated_at&order=created_at.desc&limit=1000');
 const ids=[...new Set((rows||[]).map(x=>x.user_id).filter(Boolean))],profiles=ids.length?await supa('/rest/v1/profiles?id=in.('+ids.join(',')+')&select=id,name'):[],names=new Map(profiles.map(x=>[x.id,x.name]));
 return json(res,200,{reviews:(rows||[]).map(x=>({id:x.id,recipeId:x.recipe_id,rating:x.rating,review:x.review||'',reviewer:names.get(x.user_id)||'Customer',createdAt:x.created_at,updatedAt:x.updated_at})),role:a.role});
}
async function adminUsers(req,res){if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});const a=await requireAdmin(req,res);if(!a)return;const rows=await supa('/rest/v1/profiles?select=id,name,email,points,meals_cooked,role,created_at&order=created_at.desc&limit=200');return json(res,200,{users:rows||[],role:a.role})}
async function adminSetPoints(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});const a=await requireAdmin(req,res);if(!a)return;const b=await body(req),userId=String(b.userId||''),points=Math.max(0,Math.floor(Number(b.points)));if(!userId||!Number.isFinite(points))return json(res,400,{error:'userId and a valid points value are required.'});const before=await profileFor(userId);if(!before)return json(res,404,{error:'User not found.'});const rows=await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({points})});if(!rows[0])return json(res,404,{error:'User not found.'});await supa('/rest/v1/reward_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:userId,action:'admin_adjust',points:points-Number(before.points||0),reference_id:`${Date.now()}-${a.user.id}`})}).catch(()=>{});return json(res,200,{user:rows[0]})}
async function adminSetRole(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});const a=await requireAdmin(req,res);if(!a)return;if(a.role!=='admin')return json(res,403,{error:'Only an admin can change staff roles.'});const b=await body(req),userId=String(b.userId||''),role=String(b.role||'customer').toLowerCase();if(!userId||!['customer','manager','admin'].includes(role))return json(res,400,{error:'Invalid role.'});const rows=await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({role})});return json(res,200,{user:rows[0]})}
async function adminRecipes(req,res){if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});const a=await requireAdmin(req,res);if(!a)return;const rows=await supa('/rest/v1/recipe_overrides?select=*&order=updated_at.desc');return json(res,200,{overrides:rows||[],role:a.role})}
async function adminRecipeSave(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});const a=await requireAdmin(req,res);if(!a)return;const b=await body(req),recipeId=String(b.recipeId||''),imageUrl=String(b.imageUrl||'').trim(),imageData=String(b.imageData||''),videoUrl=String(b.videoUrl||'').trim(),locked=!!b.locked;let contentJson=b.contentJson&&typeof b.contentJson==='object'?b.contentJson:{};if(!recipeId)return json(res,400,{error:'recipeId is required.'});if(imageData&&!/^data:image\/(png|jpeg|webp);base64,/i.test(imageData))return json(res,400,{error:'Uploaded image must be PNG, JPG, or WebP.'});if(imageData.length>3500000)return json(res,413,{error:'Uploaded image is too large. Please use an image under about 2.5 MB.'});if(!Array.isArray(contentJson.ingredients))contentJson.ingredients=[];if(!Array.isArray(contentJson.instructions))contentJson.instructions=[];if(!Array.isArray(contentJson.tips))contentJson.tips=[];contentJson.ingredients=contentJson.ingredients.slice(0,80).map(i=>Array.isArray(i)?[String(i[0]||'Ingredient').slice(0,120),Number(i[1])||0,String(i[2]||'each').slice(0,40),String(i[3]||i[0]||'ingredient').slice(0,120),...(Number(i[4])>0?[Math.min(Number(i[4]),1000000),String(i[5]||'').slice(0,40)]:[])]:null).filter(Boolean);contentJson.instructions=contentJson.instructions.slice(0,80).map(x=>String(x).slice(0,1000)).filter(Boolean);contentJson.tips=contentJson.tips.slice(0,40).map(x=>String(x).slice(0,500)).filter(Boolean);contentJson.baseServings=Math.max(1,Math.min(50,Math.round(Number(contentJson.baseServings)||2)));contentJson.description=String(contentJson.description||'').slice(0,500);const finalImage=imageData||imageUrl||null;const rows=await supa('/rest/v1/recipe_overrides',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({recipe_id:recipeId,image_url:finalImage,video_url:videoUrl||null,locked,content_json:contentJson,updated_by:a.user.id})});return json(res,200,{override:rows[0]})}
async function adminSales(req,res){const a=await requireAdmin(req,res);if(!a)return;if(req.method==='GET'){const rows=await supa('/rest/v1/sales?select=id,user_id,order_id,amount,currency,status,source,created_at&order=created_at.desc&limit=200');return json(res,200,{sales:rows||[],role:a.role})}if(req.method==='POST'){const b=await body(req),amount=Number(b.amount||0),status=String(b.status||'completed'),source=String(b.source||'manual'),orderId=String(b.orderId||`manual-${Date.now()}`);if(!Number.isFinite(amount)||amount<0)return json(res,400,{error:'Enter a valid sale amount.'});const rows=await supa('/rest/v1/sales',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:b.userId||null,order_id:orderId,amount,currency:String(b.currency||'USD').slice(0,8),status,source})});return json(res,200,{sale:rows[0]})}return json(res,405,{error:'Method not allowed.'})}
async function adminOrders(req,res){if(req.method==='GET'){const a=await requireAdmin(req,res);if(!a)return;const rows=await supa('/rest/v1/pending_orders?select=*&order=created_at.desc&limit=200');return json(res,200,{orders:rows||[],role:a.role})}if(req.method==='POST'){const a=await requireAdmin(req,res);if(!a)return;const b=await body(req),id=String(b.id||''),action=String(b.action||'');if(!id)return json(res,400,{error:'Order id is required.'});if(action==='verify'){const orderRows=await supa(`/rest/v1/pending_orders?id=eq.${encodeURIComponent(id)}&select=*`);const order=orderRows[0];if(!order)return json(res,404,{error:'Pending order not found.'});if(order.status==='verified')return json(res,200,{alreadyVerified:true});const rows=await supa(`/rest/v1/pending_orders?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'verified',verified_at:new Date().toISOString(),verified_by:a.user.id})});const p=await profileFor(order.user_id);const newPoints=await supa('/rest/v1/rpc/award_reward',{method:'POST',body:JSON.stringify({p_user_id:order.user_id,p_action:'recipe',p_points:10,p_reference:String(order.recipe_id)})});if(order.recipe_id){const tried=new Set(p?.tried_recipes||[]);if(!tried.has(String(order.recipe_id)))await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(order.user_id)}`,{method:'PATCH',body:JSON.stringify({tried_recipes:[...tried,String(order.recipe_id)]})})}return json(res,200,{order:rows[0],points:Number(newPoints)})}if(action==='reject'){const rows=await supa(`/rest/v1/pending_orders?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'rejected',verified_at:new Date().toISOString(),verified_by:a.user.id})});return json(res,200,{order:rows[0]})}return json(res,400,{error:'Invalid order action.'})}return json(res,405,{error:'Method not allowed.'})}
async function pendingPurchase(req,res){if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});const u=await accountUser(req,res);if(!u)return json(res,401,{error:'Sign in to track this purchase for rewards.'});const b=await body(req),recipeId=String(b.recipeId||''),orderId=String(b.orderId||'').slice(0,100);if(!recipeId)return json(res,400,{error:'recipeId is required.'});const rows=await supa('/rest/v1/pending_orders',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:u.id,recipe_id:recipeId,order_id:orderId||null,status:'pending'})});return json(res,200,{pending:rows[0]})}

async function signup(req,res){const b=await body(req),name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");if(name.length<2)return json(res,400,{error:"Enter your name."});if(!/^\S+@\S+\.\S+$/.test(email))return json(res,400,{error:"Enter a valid email."});if(password.length<8)return json(res,400,{error:"Password must be at least 8 characters."});
if(!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password))return json(res,400,{error:"Password must include a lowercase letter, uppercase letter, and number."});const a=await supaAuth("/auth/v1/signup",{method:"POST",body:JSON.stringify({email,password,data:{full_name:name}})});if(!a.ok)return json(res,a.status,{error:errorText(a.data)});if(!a.data.access_token)return json(res,200,{needsEmailConfirmation:true,message:"Check your email to confirm your account, then sign in."});const p=await ensureProfile(a.data.user,name,email);return json(res,200,{customer:publicProfile(p)},{"Set-Cookie":accountCookie(seal({access_token:a.data.access_token,refresh_token:a.data.refresh_token||null}))})}
async function login(req,res){const b=await body(req),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");const a=await supaAuth("/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})});if(!a.ok||!a.data.access_token)return json(res,401,{error:errorText(a.data)||"Email or password is incorrect."});const p=await ensureProfile(a.data.user,a.data.user.user_metadata?.full_name,email);return json(res,200,{customer:publicProfile(p)},{"Set-Cookie":accountCookie(seal({access_token:a.data.access_token,refresh_token:a.data.refresh_token||null}))})}
async function me(req,res){const u=await accountUser(req,res);if(!u)return json(res,200,{loggedIn:false});const p=await ensureProfile(u,u.user_metadata?.full_name,u.email);return json(res,200,{loggedIn:true,customer:publicProfile(p)})}
async function logout(req,res){return json(res,200,{ok:true},{"Set-Cookie":clearCookie(ACCOUNT_SESSION)})}
async function updateProfile(req,res){const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in first."});const b=await body(req),patch={};if(typeof b.name==="string"&&b.name.trim())patch.name=b.name.trim().slice(0,80);if(Array.isArray(b.taste_preferences))patch.taste_preferences=b.taste_preferences.slice(0,12).map(String);if(Array.isArray(b.dietary_preferences))patch.dietary_preferences=b.dietary_preferences.slice(0,12).map(String);if(typeof b.shopping_style==="string"&&["value","namebrand","premium","fresh","protein","cheapest"].includes(b.shopping_style))patch.shopping_style=b.shopping_style;if(Array.isArray(b.equipment_preferences)){const allowed=new Set(['Oven','Stovetop','Hot plate','Microwave','Air fryer','Slow cooker','Pressure cooker / Instant Pot','Toaster oven','Grill','Rice cooker','Blender','Food processor','Electric kettle','Mini fridge','Full-size refrigerator','Limited counter space','Limited water access','Shared kitchen','No full kitchen']);patch.equipment_preferences=[...new Set(b.equipment_preferences.map(String).filter(x=>allowed.has(x)))].slice(0,20)}if(typeof b.kitchen_notes==='string')patch.kitchen_notes=b.kitchen_notes.trim().slice(0,300)if(typeof b.cooking_level==="string"&&["Beginner","Intermediate","Advanced"].includes(b.cooking_level))patch.cooking_level=b.cooking_level;const zip=typeof b.home_zip==="string"?b.home_zip.replace(/\D/g,"").slice(0,5):"";if(zip)patch.home_zip=zip;const servings=Number(b.usual_servings);if(Number.isFinite(servings)&&servings>=1&&servings<=12)patch.usual_servings=Math.round(servings);if(typeof b.preferred_store_id==='string')patch.preferred_store_id=b.preferred_store_id.slice(0,100);if(typeof b.preferred_store_name==='string')patch.preferred_store_name=b.preferred_store_name.trim().slice(0,120);if(b.preferred_store_address&&typeof b.preferred_store_address==='object'&&!Array.isArray(b.preferred_store_address))patch.preferred_store_address=b.preferred_store_address;const email=typeof b.email==="string"?b.email.trim().toLowerCase():"";if(email&&!/^\S+@\S+\.\S+$/.test(email))return json(res,400,{error:"Enter a valid email."});if(!Object.keys(patch).length&&email===u.email)return json(res,400,{error:"No profile changes supplied."});let emailChanged=false;if(email&&email!==String(u.email||"").toLowerCase()){const a=await supaAuth("/auth/v1/user",{method:"PUT",headers:{Authorization:`Bearer ${accountSession(req).access_token}`},body:JSON.stringify({email})});if(!a.ok)return json(res,a.status,{error:errorText(a.data)||"Could not update email."});emailChanged=true}if(Object.keys(patch).length){const rows=await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});return json(res,200,{customer:publicProfile(rows[0]),emailChanged})}const p=await profileFor(u.id);return json(res,200,{customer:publicProfile(p),emailChanged})}
async function changePassword(req,res){const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Your session has expired. Please sign in again."});const b=await body(req),password=String(b.password||"");if(password.length<8||!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password))return json(res,400,{error:"Password needs 8+ characters, a lowercase letter, an uppercase letter, and a number."});const s=accountSession(req);const a=await supaAuth("/auth/v1/user",{method:"PUT",headers:{Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({password})});if(!a.ok)return json(res,a.status,{error:errorText(a.data)||"Could not change password."});return json(res,200,{ok:true})}
async function award(req,res){const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in first."});const b=await body(req),action=String(b.action||""),p=await ensureProfile(u,u.user_metadata?.full_name,u.email);if(action==="recipe"){const id=String(b.recipeId||"");if(!id)return json(res,400,{error:"recipeId is required."});return json(res,200,{customer:publicProfile(p),awarded:0,pending:true,message:"Recipe points are awarded only after a verified grocery purchase."})}
if(action==="meal"){
 const pending=await supa(`/rest/v1/pending_orders?user_id=eq.${encodeURIComponent(u.id)}&status=eq.verified&meal_logged_at=is.null&select=id,recipe_id,verified_at&order=verified_at.asc&limit=1`);
 if(!pending.length)return json(res,409,{error:"A meal can be logged after a Cook Better Co. purchase has been verified. Submit your purchase for verification first."});
 const claim=await supa(`/rest/v1/pending_orders?id=eq.${encodeURIComponent(pending[0].id)}&meal_logged_at=is.null&select=id`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({meal_logged_at:new Date().toISOString()})});
 if(!claim.length)return json(res,409,{error:"That verified purchase has already been used to log a meal."});
 const cooked=Number(p.meals_cooked||0)+1,patch={meals_cooked:cooked};let awarded=0;
 if(cooked%5===0){const newPoints=await supa("/rest/v1/rpc/award_reward",{method:"POST",body:JSON.stringify({p_user_id:u.id,p_action:"meal5",p_points:50,p_reference:`meal-${cooked}`})});awarded=Math.max(0,Number(newPoints)-Number(p.points||0));patch.points=Number(newPoints)}
 const rows=await supa(`/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
 return json(res,200,{customer:publicProfile(rows[0]),awarded,verifiedOrderId:pending[0].id});
}
if(action==="monthly"){const month=new Date().toISOString().slice(0,7),before=await profileFor(u.id);const newPoints=await supa("/rest/v1/rpc/award_reward",{method:"POST",body:JSON.stringify({p_user_id:u.id,p_action:"monthly",p_points:100,p_reference:month})});const fresh=await profileFor(u.id);return json(res,200,{customer:publicProfile(fresh),awarded:Math.max(0,Number(fresh?.points||0)-Number(before?.points||0)),monthlyClaimed:true,month})}
return json(res,400,{error:"Invalid reward action."})}
async function internalOrderReward(req,res){if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});if(!process.env.ORDER_VERIFICATION_SECRET)return json(res,503,{error:"Order verification is not configured."});const b=await body(req),secret=req.headers["x-order-verification-secret"];if(!secret||secret!==process.env.ORDER_VERIFICATION_SECRET)return json(res,403,{error:"Forbidden."});const userId=String(b.userId||""),reference=String(b.orderId||b.referenceId||"");if(!userId||!reference)return json(res,400,{error:"userId and orderId are required."});const p=await profileFor(userId);if(!p)return json(res,404,{error:"Account not found."});const newPoints=await supa("/rest/v1/rpc/award_reward",{method:"POST",body:JSON.stringify({p_user_id:userId,p_action:"order",p_points:25,p_reference:reference})});const fresh=await profileFor(userId);return json(res,200,{customer:publicProfile(fresh),awarded:Math.max(0,Number(newPoints)-Number(p.points||0))})}

function mealSchema(){return{type:"object",additionalProperties:false,properties:{name:{type:"string"},description:{type:"string"},category:{type:"string"},skillLevel:{type:"string",enum:["Beginner","Intermediate","Advanced"]},prepMinutes:{type:"number"},cookMinutes:{type:"number"},ingredients:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},amount:{type:"number"},unit:{type:"string"},searchTerm:{type:"string"}},required:["name","amount","unit","searchTerm"]}},nutrition:{type:"object",additionalProperties:false,properties:{calories:{type:"number"},protein_g:{type:"number"},carbs_g:{type:"number"},fat_g:{type:"number"}},required:["calories","protein_g","carbs_g","fat_g"]},instructions:{type:"array",items:{type:"string"}},tips:{type:"array",items:{type:"string"}},substitutions:{type:"array",items:{type:"string"}}},required:["name","description","category","skillLevel","prepMinutes","cookMinutes","ingredients","nutrition","instructions","tips","substitutions"]}}
async function callOpenAI(prompt){
 if(!process.env.OPENAI_API_KEY)throw new Error("AI is not configured. Add OPENAI_API_KEY in Vercel.");
 const payload={
  model:process.env.OPENAI_MODEL||"gpt-5.6-luna",
  input:prompt,
  text:{format:{type:"json_schema",name:"cook_better_recipe",strict:true,schema:mealSchema()}}
 };
 const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error?.message||"OpenAI request failed.");
 let raw=d.output_text;
 if(!raw&&Array.isArray(d.output))for(const item of d.output)for(const c of (item.content||[]))if(c.text){raw=c.text;break}
 if(!raw)throw new Error("AI returned no recipe.");
 try{return JSON.parse(raw)}catch{throw new Error("AI returned an invalid recipe format.")}
}
async function aiMeal(req,res){if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});const b=await body(req),prefs=Array.isArray(b.preferences)?b.preferences.slice(0,8):[],servings=Math.min(12,Math.max(1,Number(b.servings||2))),style=String(b.shoppingStyle||"value");if(!prefs.length)return json(res,400,{error:"Choose at least one taste preference first."});try{const meal=await callOpenAI(`You are Cook Better Co.'s recipe developer. Create a genuinely cookable home recipe for ${servings} servings. Taste preferences: ${prefs.join(", ")}. Grocery preference: ${style}. Prioritize normal U.S. grocery-store ingredients, realistic package sizes, strong flavor, clear technique, and a recipe that can be taught. Avoid alcohol and medical/diet claims. Do not invent impossible quantities. Include concise numbered instructions, practical tips, substitutions, and estimated nutrition per serving. Every ingredient needs a useful plain-English searchTerm for a grocery product search.`);return json(res,200,{meal})}catch(e){return json(res,502,{error:e.message})}}
async function aiImprove(req,res){if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});const b=await body(req);try{const meal=await callOpenAI(`You are Cook Better Co.'s senior recipe developer. Improve this recipe without making it complicated. Keep the same core dish, but fix weak ingredient choices, improve flavor balance and cooking technique, make quantities realistic for ${Number(b.servings||4)} servings, and make the instructions teach the cook what to look for. Return the complete improved recipe in the required schema. Original recipe: ${JSON.stringify(b.recipe||{})}`);return json(res,200,{meal})}catch(e){return json(res,502,{error:e.message})}}


async function demoUnlock(req,res){
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in before activating the presentation membership."});
 const mode=await readPaywallMode();if(mode!=="demo")return json(res,409,{error:"Demo checkout is available only while the Demo Paywall is selected by the site administrator."});
 const p=await ensureProfile(u,u.user_metadata?.full_name,u.email);
 if(String(p.subscription_status||"").toLowerCase()!=="demo"){
  const rows=await supa("/rest/v1/profiles?id=eq."+encodeURIComponent(u.id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({subscription_status:"demo"})});
  await supa("/rest/v1/sales",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:u.id,order_id:"demo-"+crypto.randomUUID(),amount:9.99,currency:"USD",status:"demo",source:"demo-checkout"})}).catch(()=>{});
  return json(res,200,{ok:true,mode:"demo",customer:publicProfile(rows[0]||{...p,subscription_status:"demo"}),message:"Demo membership activated. No payment was taken."});
 }
 return json(res,200,{ok:true,mode:"demo",customer:publicProfile(p),message:"Demo membership is already active. No payment was taken."});
}
async function stripeCheckout(req,res){
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in before subscribing."});
 const mode=await readPaywallMode();if(mode!=="real")return json(res,409,{error:"Real checkout is not active in the current site mode."});
 if(process.env.PREMIUM_CONTENT_SECURE!=="true")return json(res,503,{error:"Live payments are disabled until premium recipe content is served through authenticated server-side access. This presentation build keeps some recipe data in the browser; no payment will be taken."});if(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_PRICE_ID||!process.env.STRIPE_WEBHOOK_SECRET)return json(res,503,{error:"Live Stripe payments are not configured. Add STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and STRIPE_WEBHOOK_SECRET in Vercel before enabling real checkout."});
 const origin="https://"+req.headers.host,form=new URLSearchParams();
 form.set("mode","subscription");form.set("line_items[0][price]",process.env.STRIPE_PRICE_ID);form.set("line_items[0][quantity]","1");
 form.set("success_url",origin+"/?payment=success&session_id={CHECKOUT_SESSION_ID}");form.set("cancel_url",origin+"/?payment=cancelled");
 form.set("client_reference_id",u.id);form.set("customer_email",u.email||"");form.set("metadata[app_user_id]",u.id);form.set("subscription_data[metadata][app_user_id]",u.id);
 const r=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:form}),d=await r.json().catch(()=>({}));
 if(!r.ok||!d.url)return json(res,502,{error:d.error?.message||"Stripe could not start checkout."});
 return json(res,200,{url:d.url});
}
function safeEqualHex(a,b){try{const x=Buffer.from(a,"hex"),y=Buffer.from(b,"hex");return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}}
async function stripeWebhook(req,res){
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 if(!process.env.STRIPE_WEBHOOK_SECRET||!process.env.STRIPE_SECRET_KEY)return json(res,503,{error:"Stripe webhook is not configured."});
 const raw=await readRawBody(req),header=String(req.headers["stripe-signature"]||""),parts=header.split(",").map(x=>x.trim());
 const timestamp=parts.find(x=>x.startsWith("t="))?.slice(2),signatures=parts.filter(x=>x.startsWith("v1=")).map(x=>x.slice(3));
 if(!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300)return json(res,400,{error:"Invalid or expired Stripe signature."});
 const expected=crypto.createHmac("sha256",process.env.STRIPE_WEBHOOK_SECRET).update(timestamp+"."+raw.toString("utf8")).digest("hex");
 if(!signatures.some(sig=>safeEqualHex(sig,expected)))return json(res,400,{error:"Stripe signature verification failed."});
 let event;try{event=JSON.parse(raw.toString("utf8"))}catch{return json(res,400,{error:"Invalid webhook payload."})}
 const obj=event?.data?.object||{},userId=String(obj.metadata?.app_user_id||obj.client_reference_id||"");let status=null;
 if(event.type==="checkout.session.completed"){
  if(obj.mode==="subscription"&&obj.payment_status==="paid")status="active";
  if(userId&&status)await supa("/rest/v1/profiles?id=eq."+encodeURIComponent(userId),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({subscription_status:status,stripe_customer_id:obj.customer||null,stripe_subscription_id:obj.subscription||null})});
 }else if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted"){
  status=["active","trialing"].includes(String(obj.status||""))?"active":"free";
  if(userId)await supa("/rest/v1/profiles?id=eq."+encodeURIComponent(userId),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({subscription_status:status,stripe_customer_id:obj.customer||null,stripe_subscription_id:obj.id||null})});
 }
 return json(res,200,{received:true});
}
async function householdApi(req,res){
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in to use household profiles."});
 const p=await ensureProfile(u,u.user_metadata?.full_name,u.email);
 if(req.method==="GET"){
  const memberships=await supa("/rest/v1/household_members?user_id=eq."+encodeURIComponent(u.id)+"&select=household_id,member_role&limit=1");
  if(!memberships.length)return json(res,200,{household:null,members:[]});
  const membership=memberships[0],houses=await supa("/rest/v1/households?id=eq."+encodeURIComponent(membership.household_id)+"&select=id,name,invite_code,created_at&limit=1"),household=houses[0];
  if(!household)return json(res,200,{household:null,members:[]});
  const members=await supa("/rest/v1/household_members?household_id=eq."+encodeURIComponent(household.id)+"&select=user_id,member_role,joined_at&order=joined_at.asc"),ids=members.map(x=>x.user_id).filter(Boolean);
  const profiles=ids.length?await supa("/rest/v1/profiles?id=in.("+ids.join(",")+")&select=id,name"):[];
  const names=new Map(profiles.map(x=>[x.id,x.name]));
  return json(res,200,{household:{id:household.id,name:household.name,inviteCode:household.invite_code,memberRole:membership.member_role,createdAt:household.created_at},members:members.map(x=>({userId:x.user_id,name:names.get(x.user_id)||"Cook",role:x.member_role,joinedAt:x.joined_at}))});
 }
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 const b=await body(req),action=String(b.action||""),existing=await supa("/rest/v1/household_members?user_id=eq."+encodeURIComponent(u.id)+"&select=household_id&limit=1");
 if(existing.length)return json(res,409,{error:"This account already belongs to a household."});
 if(action==="create"){
  const name=String(b.name||"").trim().slice(0,80);if(name.length<2)return json(res,400,{error:"Enter a household name with at least 2 characters."});
  const inviteCode=crypto.randomBytes(4).toString("hex").toUpperCase(),houses=await supa("/rest/v1/households",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({name,invite_code:inviteCode,created_by:u.id})}),h=houses[0];
  if(!h)return json(res,500,{error:"Could not create household."});
  try{await supa("/rest/v1/household_members",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({household_id:h.id,user_id:u.id,member_role:"owner"})})}catch(e){await supa("/rest/v1/households?id=eq."+encodeURIComponent(h.id),{method:"DELETE"}).catch(()=>{});throw e}
  return json(res,200,{ok:true,household:{id:h.id,name:h.name,inviteCode:h.invite_code,memberRole:"owner"},members:[{userId:u.id,name:p.name||"Cook",role:"owner"}]});
 }
 if(action==="join"){
  const code=String(b.inviteCode||"").trim().toUpperCase().replace(/[^A-F0-9]/g,"").slice(0,8);if(code.length!==8)return json(res,400,{error:"Enter the 8-character household invite code."});
  const houses=await supa("/rest/v1/households?invite_code=eq."+encodeURIComponent(code)+"&select=id,name,invite_code&limit=1");if(!houses[0])return json(res,404,{error:"That household invite code was not found."});
  const membersBefore=await supa("/rest/v1/household_members?household_id=eq."+encodeURIComponent(houses[0].id)+"&select=user_id&limit=6");
  if(membersBefore.length>=5)return json(res,409,{error:"This household already has five people. The maximum household size is five."});
  try{await supa("/rest/v1/household_members",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({household_id:houses[0].id,user_id:u.id,member_role:"member"})})}
  catch(e){if(String(e.message||e).includes("five people"))return json(res,409,{error:"This household already has five people. The maximum household size is five."});throw e}
  const members=await supa("/rest/v1/household_members?household_id=eq."+encodeURIComponent(houses[0].id)+"&select=user_id,member_role,joined_at&order=joined_at.asc");
  return json(res,200,{ok:true,household:{id:houses[0].id,name:houses[0].name,inviteCode:houses[0].invite_code,memberRole:"member"},members:members.map(x=>({userId:x.user_id,name:x.user_id===u.id?p.name||"Cook":"Household member",role:x.member_role,joinedAt:x.joined_at}))});
 }
 return json(res,400,{error:"Choose create or join."});
}
async function communityRecipes(req,res){
 if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});
 const u=await accountUser(req,res),[ratings,favorites]=await Promise.all([
  supa("/rest/v1/recipe_ratings?select=recipe_id,rating,review,user_id,created_at&order=created_at.desc&limit=5000"),
  supa("/rest/v1/recipe_favorites?select=recipe_id,user_id&limit=10000")
 ]);
 const groups={},favGroups={};
 for(const row of ratings)(groups[row.recipe_id]??=[]).push(row);
 for(const row of favorites)(favGroups[row.recipe_id]??=[]).push(row.user_id);
 const userIds=[...new Set((ratings||[]).map(x=>x.user_id).filter(Boolean))];
 const profiles=userIds.length?await supa("/rest/v1/profiles?id=in.("+userIds.join(",")+")&select=id,name"):[],names=new Map(profiles.map(x=>[x.id,x.name]));
 const summary={};
 for(const id of Object.keys(groups)){const rows=groups[id],mine=u?rows.find(x=>x.user_id===u.id):null;summary[id]={count:rows.length,average:rows.reduce((n,x)=>n+Number(x.rating||0),0)/rows.length,reviews:rows.filter(x=>String(x.review||"").trim()).slice(0,8).map(x=>({rating:x.rating,review:x.review,reviewer:names.get(x.user_id)||"Community cook",createdAt:x.created_at})),userRating:mine?.rating||0,userReview:mine?.review||""}}
 for(const id of Object.keys(favGroups)){summary[id]??={count:0,average:0,reviews:[],userRating:0,userReview:""};summary[id].favorites=favGroups[id].length;summary[id].favorited=!!u&&favGroups[id].includes(u.id)}
 return json(res,200,{recipes:summary,loggedIn:!!u});
}
async function communityFavorite(req,res){
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in to save favorites."});
 const b=await body(req),recipeId=String(b.recipeId||"").trim().slice(0,100);if(!recipeId)return json(res,400,{error:"recipeId is required."});
 if(b.favorited===false){await supa("/rest/v1/recipe_favorites?recipe_id=eq."+encodeURIComponent(recipeId)+"&user_id=eq."+encodeURIComponent(u.id),{method:"DELETE"});return json(res,200,{ok:true,favorited:false})}
 await supa("/rest/v1/recipe_favorites",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify({recipe_id:recipeId,user_id:u.id})});
 return json(res,200,{ok:true,favorited:true});
}
async function communityRating(req,res){
 if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
 const u=await accountUser(req,res);if(!u)return json(res,401,{error:"Sign in to rate recipes."});
 const b=await body(req),recipeId=String(b.recipeId||"").trim().slice(0,100),rating=Math.round(Number(b.rating)),review=String(b.review||"").trim().slice(0,500);
 if(!recipeId||!Number.isInteger(rating)||rating<1||rating>5)return json(res,400,{error:"Choose a recipe and a rating from 1 to 5 stars."});
 const rows=await supa("/rest/v1/recipe_ratings?on_conflict=recipe_id,user_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({recipe_id:recipeId,user_id:u.id,rating,review,updated_at:new Date().toISOString()})});
 return json(res,200,{ok:true,rating:rows?.[0]||{recipe_id:recipeId,rating,review}});
}

module.exports=async function(req,res){try{const r=route(req);if(r==="billing/demo-unlock")return demoUnlock(req,res);if(r==="billing/checkout")return stripeCheckout(req,res);if(r==="billing/webhook")return stripeWebhook(req,res);if(r==="account/household")return householdApi(req,res);if(r==="community/recipes")return communityRecipes(req,res);if(r==="community/favorite")return communityFavorite(req,res);if(r==="community/rating")return communityRating(req,res);if(r==="stores")return stores(req,res);if(r==="products")return products(req,res);if(r==="auth/kroger")return krogerAuth(req,res);if(r==="auth/kroger/callback")return krogerCallback(req,res);if(r==="auth/status")return json(res,200,{connected:!!(await krogerUserSession(req,res))});if(r==="auth/logout")return logoutKroger(req,res);if(r==="cart/add")return cart(req,res);if(r==="account/signup")return signup(req,res);if(r==="account/login")return login(req,res);if(r==="account/me")return me(req,res);if(r==="account/logout")return logout(req,res);if(r==="account/profile")return updateProfile(req,res);if(r==="account/password")return changePassword(req,res);if(r==="rewards/award")return award(req,res);if(r==="rewards/status")return rewardStatus(req,res);if(r==="rewards/order-completed")return internalOrderReward(req,res);if(r==="ai/meal")return aiMeal(req,res);if(r==="ai/improve")return aiImprove(req,res);if(r==="content/recipes")return publicContent(req,res);if(r==="content/techniques")return publicTechniques(req,res);if(r==="admin/techniques")return adminTechniques(req,res);if(r==="analytics/event")return analyticsEvent(req,res);if(r==="admin/settings")return adminSettings(req,res);if(r==="admin/site-content")return adminSiteContent(req,res);if(r==="admin/media")return adminMediaUpload(req,res);if(r==="admin/media-sign")return adminMediaSign(req,res);if(r==="admin/stats")return adminStats(req,res);if(r==="admin/reviews")return adminReviews(req,res);if(r==="admin/users")return adminUsers(req,res);if(r==="admin/points")return adminSetPoints(req,res);if(r==="admin/role")return adminSetRole(req,res);if(r==="admin/recipes")return adminRecipes(req,res);if(r==="admin/recipe")return adminRecipeSave(req,res);if(r==="admin/sales")return adminSales(req,res);if(r==="admin/orders")return adminOrders(req,res);if(r==="rewards/pending-purchase")return pendingPurchase(req,res);return json(res,404,{error:"API route not found."})}catch(e){console.error(e);return json(res,500,{error:e.message||"Server error."})}}
async function logoutKroger(req,res){if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});return json(res,200,{ok:true},{"Set-Cookie":clearCookie(KROGER_SESSION)})}

module.exports.config = { api: { bodyParser: false } };
