const {SESSION_COOKIE,clearCookie,json}=require("../lib/kroger");
module.exports=async function(req,res){
  if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
  return json(res,200,{ok:true},{"Set-Cookie":clearCookie(SESSION_COOKIE)});
};