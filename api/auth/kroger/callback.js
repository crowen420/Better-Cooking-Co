const {TOKEN,STATE_COOKIE,SESSION_COOKIE,required,redirectUri,cookies,setCookie,clearCookie,encrypt,go}=require("../../lib/kroger");
module.exports=async function(req,res){
  try{
    if(req.method!=="GET")return res.status(405).end();
    const u=new URL(req.url,`https://${req.headers.host}`),c=cookies(req);
    const code=u.searchParams.get("code"),state=u.searchParams.get("state"),error=u.searchParams.get("error");
    if(error)return go(res,`/?kroger=error&message=${encodeURIComponent(error)}`,{"Set-Cookie":clearCookie(STATE_COOKIE)});
    if(!code||!state||state!==c[STATE_COOKIE])return go(res,"/?kroger=error&message=Invalid%20OAuth%20state",{"Set-Cookie":clearCookie(STATE_COOKIE)});
    const basic=Buffer.from(`${required("KROGER_CLIENT_ID")}:${required("KROGER_CLIENT_SECRET")}`).toString("base64");
    const r=await fetch(TOKEN,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirectUri(req)})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.access_token)return go(res,`/?kroger=error&message=${encodeURIComponent(d.error_description||d.error||"Kroger authorization failed")}`,{"Set-Cookie":clearCookie(STATE_COOKIE)});
    const s={access_token:d.access_token,refresh_token:d.refresh_token||null,expires_at:Date.now()+Math.max(60,Number(d.expires_in||1800)-60)*1000};
    return go(res,"/?kroger=connected",{"Set-Cookie":[setCookie(SESSION_COOKIE,encrypt(s)),clearCookie(STATE_COOKIE)]});
  }catch(e){console.error(e);return go(res,`/?kroger=error&message=${encodeURIComponent(e.message||"Kroger callback failed")}`)}
};