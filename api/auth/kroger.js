const {AUTHORIZE,STATE_COOKIE,required,redirectUri,setCookie,go}=require("../lib/kroger");
const crypto=require("crypto");
module.exports=async function(req,res){
  try{
    if(req.method!=="GET")return res.status(405).end();
    const state=crypto.randomBytes(24).toString("hex");
    const p=new URLSearchParams({scope:process.env.KROGER_SCOPES||"cart.basic:write product.compact profile.compact",response_type:"code",client_id:required("KROGER_CLIENT_ID"),redirect_uri:redirectUri(req),state});
    return go(res,`${AUTHORIZE}?${p}`,{"Set-Cookie":setCookie(STATE_COOKIE,state,600)});
  }catch(e){console.error(e);return go(res,`/?kroger=error&message=${encodeURIComponent(e.message||"Kroger OAuth could not start")}`)}
};