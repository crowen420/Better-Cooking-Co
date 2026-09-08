const {userSession,json}=require("../lib/kroger");
module.exports=async function(req,res){
  try{if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});return json(res,200,{connected:!!(await userSession(req,res))});}
  catch(e){console.error(e);return json(res,500,{error:e.message||"Server error."})}
};