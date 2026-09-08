const crypto = require("crypto");

const API="https://api.kroger.com/v1";
const TOKEN="https://api.kroger.com/v1/connect/oauth2/token";
const AUTHORIZE="https://api.kroger.com/v1/connect/oauth2/authorize";
const SESSION_COOKIE="cb_kroger_session";
const STATE_COOKIE="cb_kroger_state";

function required(name){
  const v=process.env[name];
  if(!v) throw new Error(`Missing Vercel environment variable: ${name}`);
  return v;
}
function redirectUri(req){
  return process.env.KROGER_REDIRECT_URI || `https://${req.headers.host}/api/auth/kroger/callback`;
}
function cookies(req){
  const out={}; const raw=req.headers.cookie||"";
  for(const part of raw.split(";")){
    const i=part.indexOf("="); if(i<0) continue;
    const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();
    try{out[k]=decodeURIComponent(v)}catch{out[k]=v}
  }
  return out;
}
function setCookie(name,value,maxAge=2592000){
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie(name){return setCookie(name,"",0)}
function key(){return crypto.createHash("sha256").update(required("SESSION_SECRET")).digest()}
function encrypt(obj){
  const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key(),iv);
  const enc=Buffer.concat([c.update(JSON.stringify(obj)),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),enc]).toString("base64url");
}
function decrypt(value){
  try{
    const b=Buffer.from(value,"base64url"),iv=b.subarray(0,12),tag=b.subarray(12,28),enc=b.subarray(28);
    const d=crypto.createDecipheriv("aes-256-gcm",key(),iv);d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc),d.final()]).toString("utf8"));
  }catch{return null}
}
function json(res,status,data,headers={}){
  res.statusCode=status;Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));
  res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(data));
}
function go(res,url,headers={}){
  res.statusCode=302;res.setHeader("Location",url);Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));res.end();
}
async function clientToken(){
  const basic=Buffer.from(`${required("KROGER_CLIENT_ID")}:${required("KROGER_CLIENT_SECRET")}`).toString("base64");
  const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials"})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error_description||d.error||"Kroger client token failed");
  return d.access_token;
}
async function userSession(req,res){
  const c=cookies(req);let s=c[SESSION_COOKIE]?decrypt(c[SESSION_COOKIE]):null;
  if(!s)return null;
  if(s.expires_at && Date.now()>=s.expires_at){
    if(!s.refresh_token){res.setHeader("Set-Cookie",clearCookie(SESSION_COOKIE));return null}
    const basic=Buffer.from(`${required("KROGER_CLIENT_ID")}:${required("KROGER_CLIENT_SECRET")}`).toString("base64");
    const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:s.refresh_token})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.access_token){res.setHeader("Set-Cookie",clearCookie(SESSION_COOKIE));return null}
    s={...s,access_token:d.access_token,refresh_token:d.refresh_token||s.refresh_token,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};
    res.setHeader("Set-Cookie",setCookie(SESSION_COOKIE,encrypt(s)));
  }
  return s;
}
async function readBody(req){
  if(req.body && typeof req.body==="object")return req.body;
  let raw="";for await(const c of req)raw+=c;
  try{return JSON.parse(raw||"{}")}catch{return {}}
}
module.exports={API,TOKEN,AUTHORIZE,SESSION_COOKIE,STATE_COOKIE,required,redirectUri,cookies,setCookie,clearCookie,encrypt,decrypt,json,go,clientToken,userSession,readBody};
