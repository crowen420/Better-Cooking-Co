const {API,clientToken,json}=require("./lib/kroger");
module.exports=async function(req,res){
  try{
    if(req.method!=="GET")return json(res,405,{error:"Method not allowed."});
    const u=new URL(req.url,`https://${req.headers.host}`);
    const term=(u.searchParams.get("term")||"").trim(),locationId=(u.searchParams.get("locationId")||"").trim();
    if(!term||!locationId)return json(res,400,{error:"term and locationId are required."});
    const token=await clientToken();
    const p=new URLSearchParams({"filter.term":term,"filter.locationId":locationId,"filter.limit":u.searchParams.get("limit")||"8"});
    const r=await fetch(`${API}/products?${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return json(res,r.status,{error:d.errors||d.error_description||"Kroger products request failed."});
    const out=(d.data||[]).map(x=>{
      const item=(x.items||[]).find(i=>i.price)||x.items?.[0]||{};
      const price=item.price?.regular ?? item.price?.promo ?? item.price?.sale ?? null;
      const fulfillment=item.fulfillment||{};
      const modality=fulfillment.csp?"csp":fulfillment.ais?"ais":fulfillment.dth?"dth":fulfillment.sth?"sth":"ais";
      const image=(x.images||[]).find(im=>im.perspective==="front")||x.images?.[0];
      return {upc:x.upc,description:x.description||x.productDescription||"",brand:x.brand||"",price,image:image?.sizes?.[0]?.url||image?.url||"",modality};
    }).filter(x=>x.upc);
    return json(res,200,{data:out});
  }catch(e){console.error(e);return json(res,500,{error:e.message||"Server error."})}
};