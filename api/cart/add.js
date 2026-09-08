const {API,userSession,json,readBody}=require("../lib/kroger");
module.exports=async function(req,res){
  try{
    if(req.method!=="PUT")return json(res,405,{error:"Method not allowed."});
    const s=await userSession(req,res);if(!s)return json(res,401,{error:"Connect your Kroger account first."});
    const body=await readBody(req);
    const items=(Array.isArray(body.items)?body.items:[]).map(x=>({quantity:Math.max(1,Number(x.quantity||1)),upc:String(x.upc||""),modality:String(x.modality||"ais")})).filter(x=>/^\d{8,14}$/.test(x.upc));
    if(!items.length)return json(res,400,{error:"No valid UPCs supplied."});
    const r=await fetch(`${API}/cart/add`,{method:"PUT",headers:{Authorization:`Bearer ${s.access_token}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({items})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:d.errors||d.error_description||d.error||"Kroger cart request failed."});
    return json(res,200,{ok:true,count:items.length});
  }catch(e){console.error(e);return json(res,500,{error:e.message||"Server error."})}
};