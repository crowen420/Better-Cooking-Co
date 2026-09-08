const {API,clientToken,json}=require("./lib/kroger");
module.exports=async function(req,res){
  try{
    if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});
    const u=new URL(req.url,`https://${req.headers.host}`);
    const zip=u.searchParams.get("zip")||"";
    if(!/^\d{5}$/.test(zip))return json(res,400,{error:"A valid 5-digit ZIP code is required."});
    const token=await clientToken();
    const p=new URLSearchParams({"filter.zipCode.near":zip,"filter.radiusInMiles":u.searchParams.get("radius")||"15","filter.limit":u.searchParams.get("limit")||"10"});
    const r=await fetch(`${API}/locations?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:d.errors||d.error_description||"Kroger locations request failed."});
    return json(res,200,{data:(d.data||[]).map(x=>({id:x.locationId,name:x.name,chain:x.chain,address:x.address,modalities:x.modality||x.modalities||[]}))});
  }catch(e){console.error(e);return json(res,500,{error:e.message||"Server error."})}
};