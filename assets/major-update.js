
(function(){
"use strict";
var paywallMode="off",stripeConfigured=false,communityData={},communityLoaded=false,cookRecipeId=null,cookSteps=[],cookStep=0,timerValue=0,timerHandle=null;
var $=function(id){return document.getElementById(id)};
var esc=function(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])})};
var safeJson=async function(response){var data=await response.json().catch(function(){return{}});if(!response.ok)throw new Error(data.error||"The request could not be completed.");return data};
var api=async function(path,options){var response=await fetch(path,options||{});return safeJson(response)};
var premiumAllowed=function(){return paywallMode==="off"||!!(currentCustomer&&((paywallMode==="demo"&&["demo","active"].includes(String(currentCustomer.subscription_status||"").toLowerCase()))||(paywallMode==="real"&&String(currentCustomer.subscription_status||"").toLowerCase()==="active")))};
function setModeNotice(message){var note=$("subscriptionNote");if(note)note.textContent=message}
function updateSubscriptionModeUI(){
 var statusEl=$("subscriptionStatus"),button=$("subscriptionCheckoutBtn");
 if(statusEl){statusEl.classList.add("on");statusEl.textContent=paywallMode==="off"?"FULL ACCESS · NO PAYWALL":paywallMode==="demo"?(premiumAllowed()?"DEMO MEMBERSHIP ACTIVE":"PRESENTATION DEMO"):(premiumAllowed()?"ACTIVE MEMBERSHIP":"MEMBERSHIP REQUIRED")}
 if(button){button.textContent=paywallMode==="off"?"Return to Cook Better Co.":paywallMode==="demo"?(premiumAllowed()?"Membership Unlocked":"Complete Fake Checkout · No Charge"):"Subscribe & Unlock";button.disabled=paywallMode==="off"||premiumAllowed()}
 if(paywallMode==="off")setModeNotice("No-paywall mode is active. All app features are available without a subscription.");
 else if(paywallMode==="demo")setModeNotice("FAKE PAYWALL: press Complete Fake Checkout to activate a demo membership. No card details are collected and no money is charged.");
 else if(!stripeConfigured)setModeNotice("Real payment mode is selected, but live checkout is safely disabled until Stripe credentials are present and premium recipe content is delivered through authenticated server-side access. No charge can be made.");
 else setModeNotice("Live subscription checkout is handled by Stripe. Access is enabled after Stripe confirms payment.");
}
window.cbPremiumAllowed=premiumAllowed;
window.isSubscriber=function(){return premiumAllowed()};
window.updateSubscriptionUI=updateSubscriptionModeUI;
async function loadPaywallMode(){
 try{
  var data=await api("/api/content/recipes");
  paywallMode=["real","demo","off"].includes(data.paywallMode)?data.paywallMode:(data.paywallEnabled?"real":"off");
  stripeConfigured=!!data.stripeConfigured;
 }catch(e){paywallMode="off";stripeConfigured=false}
 paywallEnabled=paywallMode!=="off";
 updateSubscriptionModeUI();
 if(typeof syncNavControls==="function")syncNavControls();
 if(typeof renderRecipes==="function")renderRecipes();
}
window.loadDeveloperPaywall=async function(){
 try{
  var data=await api("/api/admin/settings");
  paywallMode=["real","demo","off"].includes(data.paywallMode)?data.paywallMode:(data.paywallEnabled?"real":"off");
  stripeConfigured=!!data.stripeConfigured;paywallEnabled=paywallMode!=="off";
  renderPaywallModeControls();updateSubscriptionModeUI();
  if($("devPaywallMsg"))$("devPaywallMsg").textContent=paywallMode==="off"?"All app features are unlocked. No subscription is required.":paywallMode==="demo"?"Presentation mode: the customer sees a clearly labelled simulated checkout. Demo unlocks never charge a card.":stripeConfigured?"Live Stripe checkout is configured. Access is granted only after a verified Stripe subscription event.":"Real mode is selected, but live checkout is safely disabled until Stripe credentials and authenticated premium-content delivery are configured.";
  if(typeof renderRecipes==="function")renderRecipes();
 }catch(e){if($("devPaywallMsg"))$("devPaywallMsg").textContent=e.message}
};
function renderPaywallModeControls(){syncPaywallButtons();}
window.setPaywallMode=async function(mode){
 if(!["real","demo","off"].includes(mode))return;
 try{
  var data=await api("/api/admin/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paywallMode:mode})});
  paywallMode=data.paywallMode;stripeConfigured=!!data.stripeConfigured;paywallEnabled=paywallMode!=="off";
  renderPaywallModeControls();updateSubscriptionModeUI();
  if(typeof renderRecipes==="function")renderRecipes();
  if(typeof status==="function")status("Paywall mode changed to "+(mode==="off"?"No Paywall":mode==="demo"?"Fake Paywall":"Real Paywall")+".","ok");
  if($("devPaywallMsg"))$("devPaywallMsg").textContent=mode==="demo"?"Presentation mode is active. Customers can simulate the subscription and unlock the app. No money is taken.":mode==="off"?"The entire app is open to all visitors.":"Real checkout is selected. "+(stripeConfigured?"Stripe is configured.":"Stripe credentials and authenticated premium-content delivery are required before checkout can charge.");
 }catch(e){if(typeof status==="function")status(e.message,"err")}
};
window.setPaywall=async function(enabled){return window.setPaywallMode(enabled?"real":"off")};
window.subscriptionCheckout=async function(){
 await loadPaywallMode();
 if(paywallMode==="off"){if(typeof showHome==="function")showHome();return}
 if(premiumAllowed())return typeof status==="function"&&status("Your access is already unlocked.","ok");
 if(!currentCustomer){if(typeof openAccount==="function")openAccount();return}
 var button=$("subscriptionCheckoutBtn");
 if(button){button.disabled=true;button.textContent=paywallMode==="demo"?"Activating fake membership…":"Opening secure checkout…"}
 try{
  if(paywallMode==="demo"){
   var d=await api("/api/billing/demo-unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!d.ok||!d.customer)throw new Error(d.message||"The fake checkout could not activate your demo membership.");
   currentCustomer=d.customer;if(typeof updateAccount==="function")updateAccount(d.customer);
   updateSubscriptionModeUI();if(typeof status==="function")status("Demo membership activated. No payment was taken.","ok");
   if(typeof showHome==="function")showHome();if(typeof renderRecipes==="function")renderRecipes();
  }else{
   if(!stripeConfigured)throw new Error("Live billing is not ready. No charge was made. The administrator must configure Stripe and move premium recipe content behind authenticated server-side access.");
   var checkout=await api("/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   if(!checkout.url)throw new Error("Stripe did not return a checkout link.");window.location.href=checkout.url;return;
  }
 }catch(e){setModeNotice(e.message);if(typeof status==="function")status(e.message,"err")}
 finally{if(button){button.disabled=paywallMode==="off"||premiumAllowed();button.textContent=paywallMode==="demo"?(premiumAllowed()?"Membership Unlocked":"Complete Fake Checkout · No Charge"):"Subscribe & Unlock"}}
};

function buildAccountModeTabs(){
 var card=$("accountModal")&&$("accountModal").querySelector(".modalCard");if(!card||$("cbAccountModeTabs"))return;
 var desc=card.querySelector("p.muted");if(!desc)return;
 var tabs=document.createElement("div");tabs.id="cbAccountModeTabs";tabs.className="cbAccountTabs";
 tabs.innerHTML='<button type="button" data-mode="signin" class="active">Sign In</button><button type="button" data-mode="signup">Create Account</button>';
 desc.insertAdjacentElement("afterend",tabs);
 tabs.addEventListener("click",function(e){var button=e.target.closest("button[data-mode]");if(button)setAccountMode(button.dataset.mode)});
 var switcher=document.createElement("div");switcher.id="cbAccountModeSwitch";switcher.className="cbAccountSwitch";card.querySelector(".actions")?.insertAdjacentElement("afterend",switcher);
 setAccountMode("signin");
}
function setAccountMode(mode){
 mode=mode==="signup"?"signup":"signin";
 var name=$("accountName"),confirm=$("confirmPasswordField"),consent=$("accountConsent"),consentLabel=consent&&consent.closest("label"),tabs=$("cbAccountModeTabs"),title=$("accountTitle"),desc=$("accountModal")?.querySelector(".modalCard p.muted"),actions=$("accountModal")?.querySelector(".actions"),switcher=$("cbAccountModeSwitch");
 if(name&&name.closest(".field"))name.closest(".field").style.display=mode==="signup"?"block":"none";
 if(confirm)confirm.style.display=mode==="signup"?"block":"none";
 if(consentLabel)consentLabel.style.display=mode==="signup"?"flex":"none";
 if(title)title.textContent=mode==="signup"?"Create your Cook Better Co. account":"Welcome back";
 if(desc)desc.textContent=mode==="signup"?"Create an account to save your profile, connect your grocery store, and keep your cooking progress.":"Sign in to continue cooking, manage your household, and build your Kroger grocery list.";
 if(actions){var buttons=actions.querySelectorAll("button");if(buttons[0])buttons[0].style.display=mode==="signup"?"inline-flex":"none";if(buttons[1])buttons[1].style.display=mode==="signin"?"inline-flex":"none"}
 if(switcher)switcher.innerHTML=mode==="signup"?'Already have an account? <button type="button" onclick="setAccountMode(&quot;signin&quot;)">Sign in</button>':'New to Cook Better Co.? <button type="button" onclick="setAccountMode(&quot;signup&quot;)">Create an account</button>';
 if(tabs)tabs.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",b.dataset.mode===mode)});
 if($("accountMsg"))$("accountMsg").textContent="";
}
window.setAccountMode=setAccountMode;
var baseOpenAccount=window.openAccount;
window.openAccount=function(){if(currentCustomer){if(typeof openAccountPage==="function")openAccountPage();return}buildAccountModeTabs();setAccountMode("signin");if(typeof openModal==="function")openModal("accountModal")};
var baseUpdateAccount=window.updateAccount;
window.updateAccount=function(customer){
 if(baseUpdateAccount)baseUpdateAccount(customer);
 if(customer){currentCustomer=customer;setTimeout(refreshHousehold,0);setTimeout(applySavedZipAndStore,0)}
 updateSubscriptionModeUI();
};

var baseFindStores=window.findStores;
function persistSelectedStore(){
 if(!currentCustomer||!$("store")||!$("store").value)return;
 var storeId=$("store").value,storeList=typeof stores!=="undefined"&&Array.isArray(stores)?stores:[],store=storeList.find(function(x){return String(x.id)===String(storeId)});
 if(!store)return;
 fetch("/api/account/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({preferred_store_id:String(store.id),preferred_store_name:store.name||"Kroger",preferred_store_address:store.address||{},home_zip:$("zip")?.value||currentCustomer.home_zip||""})})
 .then(safeJson).then(function(d){currentCustomer=d.customer;if(typeof updatePlanningGate==="function")updatePlanningGate()})
 .catch(function(){if(typeof status==="function")status("Store selected for this shopping session. It could not be saved to your account right now.","err")});
}
window.findStores=async function(silent){
 if(!baseFindStores)return false;
 var ok=await baseFindStores(silent);
 if(ok&&currentCustomer?.preferred_store_id&&$("store")){
  var option=Array.from($("store").options).find(function(o){return o.value===currentCustomer.preferred_store_id});
  if(option)$("store").value=currentCustomer.preferred_store_id;
 }
 return ok;
};
function applySavedZipAndStore(){
 if(!currentCustomer)return;
 if($("zip")&&!$("zip").value&&currentCustomer.home_zip)$("zip").value=currentCustomer.home_zip;
 if($("store")&&currentCustomer.preferred_store_id){
  var option=Array.from($("store").options).find(function(o){return o.value===currentCustomer.preferred_store_id});
  if(option)$("store").value=currentCustomer.preferred_store_id;
 }
}
function enhanceStoreField(){
 var field=$("store")?.closest(".field");if(field&&!$("cbStoreNote")){var note=document.createElement("div");note.id="cbStoreNote";note.className="cbStoreNote";note.textContent="Product matches and displayed prices use this selected Kroger location. Kroger confirms pickup store, fulfillment availability, and checkout in its own cart.";field.appendChild(note)}
 $("store")?.addEventListener("change",persistSelectedStore);
}
function showStoreDisclaimer(){
 var note=$("storeAuto");if(note&&!note.dataset.cbStoreCopy)note.dataset.cbStoreCopy="1";
}

function normalizeIngredient(value){return String(value||"").toLowerCase().replace(/\([^)]*\)/g,"").replace(/[^a-z0-9]+/g," ").trim()}
function ingredientSignature(item){return normalizeIngredient(item[3]||item[0])}
function getSharedIngredients(a,b){
 var map=new Map();(a.ingredients||[]).forEach(function(i){map.set(ingredientSignature(i),i[0])});
 var out=[];(b.ingredients||[]).forEach(function(i){var key=ingredientSignature(i);if(map.has(key)&&!out.includes(map.get(key)))out.push(map.get(key))});
 return out;
}
function makeComboRecipe(a,b){
 var target=2,ingredients=new Map();
 [a,b].forEach(function(recipe){
  var factor=target/Math.max(1,Number(recipe.baseServings)||2);
  (recipe.ingredients||[]).forEach(function(item){
   var name=String(item[0]||"Ingredient"),amount=(Number(item[1])||0)*factor,unit=String(item[2]||"each"),term=String(item[3]||name),key=ingredientSignature(item)+"|"+unit.toLowerCase();
   if(ingredients.has(key))ingredients.get(key)[1]+=amount;
   else ingredients.set(key,[name,amount,unit,term,...(Number(item[4])>0?[Number(item[4]),String(item[5]||"")]:[])]);
  });
 });
 return {id:"combo_"+a.id+"_"+b.id,name:a.name+" + "+b.name,category:"Smart Meal Combination",tags:["Shared Ingredients","Two Meals"],img:a.img||b.img,baseServings:target,description:"A two-meal grocery combination that groups overlapping ingredients to reduce one-off purchases and food waste.",ingredients:Array.from(ingredients.values()),instructions:["Prepare the grocery items for both meals. The shopping list combines overlapping ingredients so you can buy them once.", "First meal — "+a.name+":",...(a.instructions||[]),"Second meal — "+b.name+":",...(b.instructions||[])],tips:["Shared ingredients are combined in the grocery list.","Check the selected Kroger store for live product matches before adding anything to your cart."],nutrition:{cal:"—",protein:"—",carbs:"—",fat:"—"},visible:true,sortOrder:9999};
}
function ensureFeatureSection(id,after,markup){
 if($(id))return $(id);
 var node=document.createElement("section");node.id=id;node.className="cbFeatureSection";node.innerHTML=markup;
 if(after&&after.parentNode)after.insertAdjacentElement("afterend",node);else document.querySelector("main")?.appendChild(node);
 return node;
}

function ensureFeatureDirectory(){
 var markup='<div class="cbSectionIntro"><div class="eyebrow">COOK BETTER CO. · EXPLORE</div><h2>More than a recipe list. <span class="accent">Your kitchen toolkit.</span></h2><p>Everything in Cook Better Co. has a place. Choose a tool below to jump into the experience.</p></div><div class="cbToolGrid">'+
  '<article class="cbToolCard"><div class="cbToolIcon">🥘</div><div class="eyebrow">PLAN SMARTER</div><h3>Smart meal combinations</h3><p>Pair recipes that share ingredients and create one combined grocery list.</p><button class="btn secondary" type="button" data-cb-explore="combinations">Explore combinations</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">👨‍🍳</div><div class="eyebrow">LEARN BY DOING</div><h3>Guided cooking</h3><p>Open a recipe for step-by-step cooking mode, progress tracking, and built-in timers.</p><button class="btn secondary" type="button" data-cb-explore="guided">Find a recipe</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">📊</div><div class="eyebrow">KNOW YOUR MEAL</div><h3>Nutrition estimates</h3><p>See estimated calories, protein, carbs, and fat per serving on recipe cards.</p><button class="btn secondary" type="button" data-cb-explore="nutrition">View nutrition</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">🛒</div><div class="eyebrow">SHOP YOUR STORE</div><h3>Store-aware grocery shopping</h3><p>Choose a ZIP code and Kroger location so product matching uses your selected store.</p><button class="btn secondary" type="button" data-cb-explore="shopping">Build a grocery list</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">🔁</div><div class="eyebrow">COMPARE PRODUCTS</div><h3>Product substitutions</h3><p>Compare alternatives by product photo, brand, package size, and price.</p><button class="btn secondary" type="button" data-cb-explore="substitutions">Explore swaps</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">👨‍👩‍👧‍👦</div><div class="eyebrow">COOK TOGETHER</div><h3>Household profiles</h3><p>Create a household or join one with an invite code from your account page.</p><button class="btn secondary" type="button" data-cb-explore="household">Manage household</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">⭐</div><div class="eyebrow">SHARE YOUR FAVORITES</div><h3>Community ratings</h3><p>Rate and review recipes, and save the meals you want to make again.</p><button class="btn secondary" type="button" data-cb-explore="community">Visit community</button></article>'+
  '<article class="cbToolCard"><div class="cbToolIcon">🎥</div><div class="eyebrow">BUILD YOUR SKILLS</div><h3>Technique video library</h3><p>Open the technique library for lessons published by Cook Better Co.</p><button class="btn secondary" type="button" data-cb-explore="techniques">Open techniques</button></article>'+
 '</div>';
 return ensureFeatureSection("cbFeatureDirectory",$("featureStrip")||$("hero"),markup);
}
var activeFeatureNode=null,activeFeaturePlaceholder=null;
function ensureFeaturePage(){
 var page=$("cbFeaturePage");if(page)return page;
 page=document.createElement("main");page.id="cbFeaturePage";page.className="cbFeaturePage";
 var dev=$("developerPage");if(dev&&dev.parentNode)dev.parentNode.insertBefore(page,dev);else document.body.appendChild(page);
 return page;
}
function restoreFeatureNode(){
 if(activeFeatureNode&&activeFeaturePlaceholder&&activeFeaturePlaceholder.parentNode){
  activeFeaturePlaceholder.parentNode.insertBefore(activeFeatureNode,activeFeaturePlaceholder);
  activeFeaturePlaceholder.remove();activeFeatureNode.style.display="none";delete activeFeatureNode.dataset.cbFeaturePage;
 }
 activeFeatureNode=null;activeFeaturePlaceholder=null;
}
function closeFeaturePage(){
 restoreFeatureNode();var page=$("cbFeaturePage");if(page){page.classList.remove("open");page.innerHTML="";page.style.display="none"}
 $("homeMain")?.classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});
}
async function openFeaturePage(action){
 if(action==="household"){if(typeof window.openAccount==="function")window.openAccount();return}
 if(action==="techniques"){
  if(typeof window.openTechniqueLibrary==="function")await window.openTechniqueLibrary();
  var tech=$("techniqueLibrary");if(!tech||tech.style.display==="none")return;
  action="techniques";
 }
 if(action==="community")await refreshCommunity();
 if(action==="combinations")renderSmartCombos();
 var config={
  combinations:{title:"Smart meal combinations",subtitle:"Pair meals that share ingredients, then shop once for both." ,source:"smartCombosSection"},
  community:{title:"Community favorites",subtitle:"Real ratings and written reviews from Cook Better Co. cooks.",source:"communitySection"},
  learning:{title:"Learn to cook and improve",subtitle:"Build real skills with technique lessons and recipe videos.",source:"learn"},
  techniques:{title:"Quick shopping & cooking techniques",subtitle:"Short technique lessons from Cook Better Co.",source:"techniqueLibrary"},
  guided:{title:"Guided cooking",subtitle:"Choose a recipe and follow its cooking steps one at a time.",source:"recipes"},
  nutrition:{title:"Nutrition estimates",subtitle:"Explore per-serving estimates on each recipe.",source:"recipes"},
  shopping:{title:"Grocery shopping",subtitle:"Choose a meal and build a store-aware shopping list.",source:"recipes"},
  substitutions:{title:"Product substitutions",subtitle:"Compare product alternatives, package sizes, and prices.",source:"recipes"}
 };
 var c=config[action];if(!c)return;
 var source=$(c.source);if(!source)return;
 closeFeaturePage();
 var page=ensureFeaturePage();page.innerHTML='<div class="cbFeaturePageInner"><div class="cbFeaturePageHead"><button class="btn secondary" type="button" data-cb-back>← Back to Home</button><div class="eyebrow">COOK BETTER CO. · EXPLORE</div><h1>'+esc(c.title)+'</h1><p class="muted">'+esc(c.subtitle)+'</p></div><div class="cbFeaturePageContent" id="cbFeaturePageContent"></div></div>';
 var content=$("cbFeaturePageContent");
 if(action==="guided"||action==="nutrition"||action==="shopping"||action==="substitutions"){
  var recipeGrid=$("recipeGrid");
  if(recipeGrid){var intro=document.createElement("div");intro.className="cbFeaturePageHint";intro.textContent=action==="guided"?"Open a recipe and choose Guided Cooking Mode.":action==="nutrition"?"Open a recipe and select its Nutrition option.":action==="shopping"?"Open a recipe and build your grocery list.":"Open a recipe, build its grocery list, and choose Swap beside an item.";content.appendChild(intro);var grid=recipeGrid.cloneNode(true);grid.removeAttribute("id");content.appendChild(grid)}
 }else{
  activeFeaturePlaceholder=document.createComment("Cook Better Co. feature return point");
  source.parentNode.insertBefore(activeFeaturePlaceholder,source);content.appendChild(source);activeFeatureNode=source;source.style.display="block";source.dataset.cbFeaturePage="1";
 }
 $("homeMain")?.classList.add("hidden");page.style.display="block";page.classList.add("open");window.scrollTo({top:0,behavior:"smooth"});
}
function handleExploreAction(action){openFeaturePage(action)}


function renderSmartCombos(){
 if(typeof recipes==="undefined"||typeof recipeSortList!=="function")return;
 var all=recipeSortList().filter(function(r){return !String(r.id).startsWith("combo_")&&Array.isArray(r.ingredients)&&r.ingredients.length});
 var pairs=[];
 for(var i=0;i<all.length;i++)for(var j=i+1;j<all.length;j++){
  var shared=getSharedIngredients(all[i],all[j]);if(shared.length)pairs.push({a:all[i],b:all[j],shared:shared});
 }
 pairs.sort(function(x,y){return y.shared.length-x.shared.length});
 var unique=pairs.slice(0,3),html='<div class="cbSectionIntro"><div class="eyebrow">SMART MEAL COMBINATIONS</div><h2>Make two meals. <span class="accent">Shop smarter.</span></h2><p>Cook Better Co. finds recipes that reuse ingredients, then builds one combined grocery list. This is a recipe-pairing tool, not a weekly meal calendar.</p></div>';
 if(!unique.length)html+='<div class="cbEmptyState">Add a few more recipes to your library to generate ingredient-sharing combinations.</div>';
 else html+='<div class="cbComboGrid">'+unique.map(function(pair,index){
  var image=esc(pair.a.img||pair.b.img||"");
  return '<article class="cbFeatureCard"><img src="'+image+'" alt="'+esc(pair.a.name)+' and '+esc(pair.b.name)+'"><div class="cbFeatureBody"><div class="eyebrow">PAIRING '+(index+1)+'</div><h3>'+esc(pair.a.name)+' + '+esc(pair.b.name)+'</h3><p>These recipes share '+pair.shared.length+' grocery ingredients, which can be combined into one shopping list.</p><div class="cbChipRow">'+pair.shared.slice(0,5).map(function(x){return '<span class="cbChip">'+esc(x)+'</span>'}).join("")+'</div><button class="btn primary" type="button" data-combo-a="'+esc(pair.a.id)+'" data-combo-b="'+esc(pair.b.id)+'">Build combined grocery list</button></div></article>';
 }).join("")+'</div>';
 var section=ensureFeatureSection("smartCombosSection",$("recipes"),html);
 if(section)section.innerHTML=html;

}
function ensureCommunitySection(){
 var section=ensureFeatureSection("communitySection",$("smartCombosSection")||$("recipes"),'<div class="cbSectionIntro"><div class="eyebrow">COOK BETTER COMMUNITY</div><h2>Community <span class="accent">favorites.</span></h2><p>Save recipes you love and see what other home cooks are enjoying.</p></div><div id="cbCommunityGrid" class="cbCommunityGrid"><div class="cbEmptyState">Loading community favorites…</div></div>');
 return section;
}
function stars(n){var count=Math.max(0,Math.min(5,Math.round(Number(n)||0)));return "★".repeat(count)+"☆".repeat(5-count)}
async function refreshCommunity(){
 ensureCommunitySection();
 try{var d=await api("/api/community/recipes");communityData=d.recipes||{};communityLoaded=true;renderCommunityCards()}
 catch(e){var box=$("cbCommunityGrid");if(box)box.innerHTML='<div class="cbEmptyState">Community favorites are temporarily unavailable. You can still browse recipes and add your own ratings.</div>'}
}
function renderCommunityCards(){
 var box=$("cbCommunityGrid");if(!box||typeof recipeSortList!=="function")return;
 var all=recipeSortList().filter(function(r){return !String(r.id).startsWith("combo_")});
 var sorted=all.slice().sort(function(a,b){var aa=communityData[a.id]||{},bb=communityData[b.id]||{};return Number(bb.favorites||0)*2+Number(bb.count||0)-Number(aa.favorites||0)*2-Number(aa.count||0)});
 var list=sorted.slice(0,3);
 if(!list.length){box.innerHTML='<div class="cbEmptyState">Recipes will appear here as the community saves and rates them.</div>';return}
 box.innerHTML=list.map(function(r){
  var data=communityData[r.id]||{},average=Number(data.average||0),count=Number(data.count||0),favorites=Number(data.favorites||0),isFav=!!data.favorited;
  var reviews=(data.reviews||[]).filter(function(x){return String(x.review||"").trim()}).slice(0,2);
  var reviewHtml=reviews.length?'<div class="cbReviewSnippets">'+reviews.map(function(x){return '<blockquote class="cbReviewQuote"><div class="cbRatingLine">'+stars(x.rating)+' <small>'+esc(x.reviewer||"Community cook")+'</small></div><p>'+esc(x.review)+'</p></blockquote>'}).join("")+'</div>':'<p class="cbNoReviews">No written reviews yet. Be the first to share what you thought.</p>';
  return '<article class="cbFeatureCard"><img src="'+esc(r.img||"")+'" alt="'+esc(r.name)+'"><div class="cbFeatureBody"><h3>'+esc(r.name)+'</h3><div class="cbRatingLine">'+stars(average)+' <small>'+(count?average.toFixed(1)+" · "+count+" ratings":"No ratings yet")+'</small></div><div class="cbFeatureMeta">'+favorites+' saved by the community</div>'+reviewHtml+'<div class="cbCommunityActions"><button class="btn secondary" type="button" data-community-open="'+esc(r.id)+'">View recipe</button><button class="btn '+(isFav?"secondary":"primary")+'" type="button" data-community-fav="'+esc(r.id)+'">'+(isFav?"♥ Saved":"♡ Save favorite")+'</button></div></div></article>';
 }).join("");
}
async function toggleCommunityFavorite(recipeId){
 if(!currentCustomer){window.openAccount();return}
 var old=communityData[recipeId]||{},newValue=!old.favorited;
 try{await api("/api/community/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipeId:recipeId,favorited:newValue})});if(typeof status==="function")status(newValue?"Recipe saved to your favorites.":"Removed from your favorites.","ok");await refreshCommunity();if($("recipePage")?.classList.contains("open"))decorateRecipePage(recipeId)}
 catch(e){if(typeof status==="function")status(e.message,"err")}
}
function decorateRecipePage(recipeId){
 var page=$("recipePage");if(!page||!page.classList.contains("open"))return;
 var actions=page.querySelector(".recipeHeroContent .actions");
 if(actions&&!$("cbCookModeButton")){var cook=document.createElement("button");cook.id="cbCookModeButton";cook.className="btn secondary";cook.type="button";cook.textContent="▶ Guided cooking mode";cook.addEventListener("click",function(){startCookingMode(recipeId)});actions.appendChild(cook)}
 var grid=page.querySelector(".detailGrid");if(!grid||$("cbRecipeCommunity"))return;
 var data=communityData[recipeId]||{},isFav=!!data.favorited,avg=Number(data.average||0),count=Number(data.count||0);
 var panel=document.createElement("div");panel.id="cbRecipeCommunity";panel.className="detailCard cbReviewPanel";
 var reviewRows=(data.reviews||[]).filter(function(x){return String(x.review||"").trim()});
 var reviewList=reviewRows.length?'<div class="cbReviewList"><h3>What cooks are saying</h3>'+reviewRows.map(function(x){return '<article class="cbReviewQuote"><div class="cbRatingLine">'+stars(x.rating)+' <small>'+esc(x.reviewer||"Community cook")+' · '+(x.createdAt?esc(new Date(x.createdAt).toLocaleDateString()):"")+'</small></div><p>'+esc(x.review)+'</p></article>'}).join("")+'</div>':'<p class="cbNoReviews">No written reviews yet. Your review can help the next cook.</p>';
 panel.innerHTML='<div class="cbRecipeCommunityHead"><div><h2>Community feedback</h2><div class="cbRatingLine">'+stars(avg)+' <small>'+(count?avg.toFixed(1)+' · '+count+' ratings':'Be the first to rate this recipe')+'</small></div></div><button class="btn secondary cbFavoriteBtn" type="button" id="cbRecipeFavorite">'+(isFav?'♥ Saved to favorites':'♡ Save to favorites')+'</button></div><div class="cbCommunitySmall">'+(data.favorites||0)+' cooks saved this recipe.</div>'+reviewList+'<div class="cbReviewForm"><div class="field"><label for="cbRatingValue">Your rating</label><select id="cbRatingValue"><option value="5">5 stars — Loved it</option><option value="4">4 stars — Really good</option><option value="3">3 stars — Good</option><option value="2">2 stars — Not for me</option><option value="1">1 star — Needs work</option></select></div><div class="field"><label for="cbReviewText">Review (optional)</label><textarea id="cbReviewText" maxlength="500" placeholder="What did you think of this recipe?"></textarea></div><button class="btn primary" type="button" id="cbSubmitReview">Submit review</button></div>';
 grid.appendChild(panel);
 $("cbRecipeFavorite")?.addEventListener("click",function(){toggleCommunityFavorite(recipeId)});
 $("cbSubmitReview")?.addEventListener("click",function(){submitCommunityRating(recipeId)});
 if(data.userRating)$("cbRatingValue").value=String(data.userRating);
 if(data.userReview)$("cbReviewText").value=data.userReview;
}
async function submitCommunityRating(recipeId){
 if(!currentCustomer){window.openAccount();return}
 var rating=Number($("cbRatingValue")?.value||5),review=$("cbReviewText")?.value||"";
 try{await api("/api/community/rating",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipeId:recipeId,rating:rating,review:review})});if(typeof status==="function")status("Thanks — your rating has been saved.","ok");await refreshCommunity();decorateRecipePage(recipeId)}
 catch(e){if(typeof status==="function")status(e.message,"err")}
}
window.submitCommunityRating=submitCommunityRating;
var baseOpenRecipe=window.openRecipePage;
window.openRecipePage=function(id){if(baseOpenRecipe)baseOpenRecipe(id);setTimeout(function(){decorateRecipePage(id)},0)};

function ensureCookOverlay(){
 if($("cbCookOverlay"))return;
 var div=document.createElement("div");div.id="cbCookOverlay";div.className="cbCookOverlay";
 div.innerHTML='<div class="cbCookCard" role="dialog" aria-modal="true" aria-labelledby="cbCookTitle"><div class="cbCookTop"><div><div class="eyebrow">COOK BETTER CO. · GUIDED COOKING</div><h2 id="cbCookTitle" style="margin:7px 0 0">Cooking mode</h2></div><button class="btn secondary" type="button" id="cbCookClose">Close</button></div><div class="cbCookProgress"><span id="cbCookProgressBar" style="width:0%"></span></div><div class="cbCookStepLabel" id="cbCookStepLabel">STEP 1</div><div class="cbCookInstruction" id="cbCookInstruction">Your first cooking step will appear here.</div><div class="cbCookActions"><button class="btn secondary" type="button" id="cbCookPrevious">← Previous</button><button class="btn primary" type="button" id="cbCookNext">Next step →</button></div><div class="cbTimerPanel"><div><div class="eyebrow">STEP TIMER</div><div class="cbTimerClock" id="cbCookTimerClock">05:00</div></div><select id="cbCookTimerLength" aria-label="Timer duration"><option value="1">1 minute</option><option value="5" selected>5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option></select><button class="btn secondary" type="button" id="cbCookTimerStart">Start timer</button><button class="btn ghost" type="button" id="cbCookTimerReset">Reset</button></div></div>';
 document.body.appendChild(div);
 $("cbCookClose").addEventListener("click",closeCookingMode);
 $("cbCookPrevious").addEventListener("click",function(){moveCookStep(-1)});
 $("cbCookNext").addEventListener("click",function(){moveCookStep(1)});
 $("cbCookTimerStart").addEventListener("click",toggleCookTimer);
 $("cbCookTimerReset").addEventListener("click",resetCookTimer);
 $("cbCookTimerLength").addEventListener("change",resetCookTimer);
 div.addEventListener("click",function(e){if(e.target===div)closeCookingMode()});
}
function startCookingMode(recipeId){
 var r=recipes[recipeId];if(!r)return;
 if(!currentCustomer){window.openAccount();return}
 if(!premiumAllowed()&&recipeSortList().findIndex(function(x){return x.id===recipeId})>=4){if(typeof openSubscription==="function")openSubscription();return}
 cookRecipeId=recipeId;cookSteps=Array.isArray(r.instructions)?r.instructions.slice():[];cookStep=0;if(!cookSteps.length)return;
 ensureCookOverlay();$("cbCookTitle").textContent=r.name+" · Cooking mode";resetCookTimer();renderCookStep();$("cbCookOverlay").classList.add("open");
}
function renderCookStep(){
 var total=cookSteps.length; $("cbCookStepLabel").textContent="STEP "+(cookStep+1)+" OF "+total;
 $("cbCookInstruction").textContent=cookSteps[cookStep];
 $("cbCookProgressBar").style.width=((cookStep+1)/Math.max(1,total)*100)+"%";
 $("cbCookPrevious").disabled=cookStep===0;$("cbCookNext").textContent=cookStep===total-1?"Finish recipe":"Next step →";
}
function moveCookStep(direction){
 if(direction>0&&cookStep>=cookSteps.length-1){closeCookingMode();if(typeof markMealCooked==="function"&&confirm("Mark this meal as cooked?"))markMealCooked();return}
 cookStep=Math.max(0,Math.min(cookSteps.length-1,cookStep+direction));renderCookStep();resetCookTimer();
}
function formatTimer(seconds){var m=Math.floor(seconds/60),s=seconds%60;return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")}
function paintTimer(){if($("cbCookTimerClock"))$("cbCookTimerClock").textContent=formatTimer(timerValue)}
function resetCookTimer(){if(timerHandle){clearInterval(timerHandle);timerHandle=null}timerValue=Number($("cbCookTimerLength")?.value||5)*60;paintTimer();if($("cbCookTimerStart"))$("cbCookTimerStart").textContent="Start timer"}
function toggleCookTimer(){
 if(timerHandle){clearInterval(timerHandle);timerHandle=null;$("cbCookTimerStart").textContent="Resume timer";return}
 if(timerValue<=0)resetCookTimer();
 $("cbCookTimerStart").textContent="Pause timer";
 timerHandle=setInterval(function(){timerValue=Math.max(0,timerValue-1);paintTimer();if(timerValue===0){clearInterval(timerHandle);timerHandle=null;$("cbCookTimerStart").textContent="Start timer";if(typeof status==="function")status("Cooking timer finished.","ok")}},1000);
}
function closeCookingMode(){if(timerHandle){clearInterval(timerHandle);timerHandle=null}$("cbCookOverlay")?.classList.remove("open")}
window.startCookingMode=startCookingMode;

function ensureHouseholdPanel(){
 var grid=document.querySelector("#accountPage .accountInfoGrid");if(!grid||$("cbHouseholdPanel"))return;
 var panel=document.createElement("div");panel.id="cbHouseholdPanel";panel.className="panel cbHouseholdPanel";
 panel.innerHTML='<h2>Household profiles</h2><p class="muted">Create a shared household or join one with an invite code. Household membership keeps family profiles connected under one group.</p><div id="cbHouseholdContent"><div class="status">Loading household…</div></div>';
 grid.appendChild(panel);
}
async function refreshHousehold(){
 ensureHouseholdPanel();var box=$("cbHouseholdContent");if(!box)return;
 if(!currentCustomer){box.innerHTML='<div class="cbEmptyState">Sign in to create or join a household.</div>';return}
 box.innerHTML='<div class="status">Loading your household…</div>';
 try{var d=await api("/api/account/household");renderHousehold(d)}
 catch(e){box.innerHTML='<div class="cbEmptyState">'+esc(e.message)+'</div>'}
}
function renderHousehold(data){
 var box=$("cbHouseholdContent");if(!box)return;
 if(!data.household){
  box.innerHTML='<div class="field"><label for="cbHouseholdName">Household name</label><input id="cbHouseholdName" maxlength="80" placeholder="The Owen household"></div><button type="button" class="btn primary" id="cbCreateHousehold">Create household</button><div class="cbModeNotice">Already have an invite? Join a household below.</div><div class="field"><label for="cbHouseholdInvite">Invite code</label><input id="cbHouseholdInvite" maxlength="8" placeholder="8-character code" autocapitalize="characters"></div><button type="button" class="btn secondary" id="cbJoinHousehold">Join household</button><div class="status" id="cbHouseholdStatus"></div>';
  $("cbCreateHousehold").addEventListener("click",createHousehold);$("cbJoinHousehold").addEventListener("click",joinHousehold);return;
 }
 var h=data.household,memberCount=(data.members||[]).length,atLimit=memberCount>=5;
 box.innerHTML='<div class="accountMini"><strong>'+esc(h.name)+'</strong><span class="muted">'+memberCount+' of 5 household members</span></div><div class="cbHouseholdCode"><div><div class="eyebrow">INVITE CODE</div><code>'+esc(h.inviteCode)+'</code></div><button class="btn secondary" type="button" id="cbCopyInvite">Copy code</button></div><div class="cbHouseholdMembers">'+(data.members||[]).map(function(m){return '<div class="cbHouseholdMember"><strong>'+esc(m.name)+'</strong><span>'+esc(m.role)+'</span></div>'}).join("")+'</div><div class="status">'+(atLimit?'Your household has reached the five-person limit.':'Share the invite code with up to '+(5-memberCount)+' more household member(s).')+'</div>';
 $("cbCopyInvite").addEventListener("click",function(){if(navigator.clipboard?.writeText)navigator.clipboard.writeText(h.inviteCode).then(function(){if(typeof status==="function")status("Household invite code copied.","ok")});else if(typeof status==="function")status("Invite code: "+h.inviteCode,"ok")});
}
async function createHousehold(){
 var name=$("cbHouseholdName")?.value.trim(),msg=$("cbHouseholdStatus");if(!name||name.length<2){if(msg)msg.textContent="Enter a household name.";return}
 try{await api("/api/account/household",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",name:name})});await refreshHousehold();if(typeof status==="function")status("Household created. Share the invite code with family.","ok")}
 catch(e){if(msg)msg.textContent=e.message}
}
async function joinHousehold(){
 var code=$("cbHouseholdInvite")?.value.trim(),msg=$("cbHouseholdStatus");if(!code){if(msg)msg.textContent="Enter an invite code.";return}
 try{await api("/api/account/household",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"join",inviteCode:code})});await refreshHousehold();if(typeof status==="function")status("You joined the household.","ok")}
 catch(e){if(msg)msg.textContent=e.message}
}
window.refreshHousehold=refreshHousehold;

function enhanceSwapCards(){
 var grid=$("swapGrid");if(!grid||!grid.classList.contains("open")&& !document.getElementById("swapModal")?.classList.contains("open"))return;
 var idx=window.swapIndex,g=typeof groceryResults!=="undefined"?groceryResults[idx]:null,list=g&&Array.isArray(g.products)?g.products:[];
 if(!list.length)return;
 grid.innerHTML=list.map(function(p,n){
  var image=p.image||ingredientImage(g.ingredient),price=Number(p.price||0),brand=p.brand||"Kroger selection",description=p.description||g.ingredient;
  return '<button type="button" class="swapCard cbSwapCard" data-cb-swap-upc="'+esc(p.upc)+'"><img src="'+esc(image)+'" alt="'+esc(description)+'"><div><div class="cbSwapName">'+esc(brand)+' · '+esc(description)+'</div><div class="cbSwapSub">'+(p.size?esc(p.size):"Package size not listed")+'</div><div class="cbSwapPrice">'+(price>0?"$"+price.toFixed(2):"Price unavailable")+'</div><span class="cbSwapPill">'+(n===0?"Top match":"Available at selected store")+'</span></div></button>';
 }).join("");
 grid.querySelectorAll("[data-cb-swap-upc]").forEach(function(button){button.addEventListener("click",function(){if(typeof chooseSwap==="function")chooseSwap(button.dataset.cbSwapUpc)})});
}
var baseSwapProduct=window.swapProduct;
window.swapProduct=async function(i){if(baseSwapProduct)await baseSwapProduct(i);enhanceSwapCards()};
window.chooseSwap=window.chooseSwap;
function watchRecipeGrid(){
 var grid=$("recipeGrid");if(!grid||grid.dataset.cbObserved)return;
 grid.dataset.cbObserved="1";
 var observer=new MutationObserver(function(){renderSmartCombos();if(communityLoaded)renderCommunityCards()});
 observer.observe(grid,{childList:true,subtree:true});
}

function syncPaywallButtons(){
 var statusEl=$("devPaywallStatus");
 if(statusEl){
  statusEl.textContent=paywallMode==="off"?"NO PAYWALL · FULL ACCESS":paywallMode==="demo"?"FAKE PAYWALL · DEMO CHECKOUT":"REAL PAYWALL · MEMBERSHIP REQUIRED";
  statusEl.classList.toggle("on",paywallMode!=="off");
 }
 [["paywallModeReal","real"],["paywallModeDemo","demo"],["paywallModeOff","off"]].forEach(function(pair){
  var button=$(pair[0]);if(!button)return;
  var selected=paywallMode===pair[1];
  button.classList.toggle("active",selected);
  button.setAttribute("aria-pressed",selected?"true":"false");
 });
 var billing=$("cbStripeStatus");
 if(billing){
  billing.innerHTML=paywallMode==="off"?"Payment mode: <strong>No Paywall</strong>. All recipes and technique videos are open.":paywallMode==="demo"?"Payment mode: <strong>Fake Paywall</strong>. Demo checkout never collects card details or charges money.":stripeConfigured?"Payment processor: <strong>Stripe configured</strong>. Complete a test subscription before enabling live billing.":"Payment processor: <strong>Not ready for live billing</strong>. Stripe credentials and authenticated server-side premium-content delivery are both required before a real charge can occur.";
 }
 var message=$("devPaywallMsg");
 if(message)message.textContent=paywallMode==="off"?"No Paywall is active. Full recipes, all cooking steps, and technique videos are available without a subscription.":paywallMode==="demo"?"Fake Paywall is active. Customers see a two-step, three-ingredient preview and can unlock the full experience through simulated checkout. No money is taken.":stripeConfigured?"Real Paywall is active. Customers need a confirmed Stripe membership.":"Real Paywall is selected. Checkout is safely disabled until Stripe and secure premium-content delivery are configured.";
}
function syncNavControls(){
 var rewardButton=$("navRewardsBtn"),rewardPoints=$("navRewardsPoints"),accountButton=$("accountTopBtn"),krogerButton=$("navKrogerBtn"),techniques=$("techniqueNav");
 if(rewardButton)rewardButton.style.display=currentCustomer?"inline-flex":"none";
 if(rewardPoints)rewardPoints.textContent=Number(currentCustomer?.points||0).toLocaleString()+" pts";
 if(accountButton)accountButton.textContent=currentCustomer?(currentCustomer.name||"Account"):"Account";
 if(krogerButton){
  krogerButton.style.display="inline-flex";
  krogerButton.setAttribute("aria-label",krogerConnected?"Kroger connected":"Connect Kroger");
  var label=$("krogerBtnText");
  if(label)label.textContent=krogerConnected?"✓ Kroger Connected":"Connect Kroger";
  krogerButton.onclick=krogerConnected?function(){if(typeof status==="function")status("Kroger is connected. Manage your grocery account from this button.","ok")}:function(){if(typeof window.connectKroger==="function")window.connectKroger()};
 }
 var heroCta=$("heroPrimaryCta"),trust=document.querySelector(".heroTrustLine"),gate=$("planningGate");
 if(heroCta){
  if(currentCustomer){heroCta.style.display="none"}
  else{heroCta.style.display="inline-flex";heroCta.textContent="Create your free account";heroCta.onclick=function(){window.openAccount()}}
 }
 if(trust)trust.style.display="none";
 // Connection and sign-in prompts live only in the top navigation.
 if(gate)gate.style.display="none";
 var planningSteps=document.querySelector(".planningSteps");
 if(planningSteps)planningSteps.innerHTML='<div class="planningStep"><b>01</b><span>Choose meals</span></div><div class="planningStep"><b>02</b><span>Learn as you cook</span></div><div class="planningStep"><b>03</b><span>Shop your list</span></div>';
 var homeAccount=$("account");if(homeAccount)homeAccount.style.display="none";
 var learnSection=$("learn");if(learnSection&&!learnSection.dataset.cbFeaturePage)learnSection.style.display="none";
 var combos=$("smartCombosSection");if(combos&&!combos.dataset.cbFeaturePage)combos.style.display="none";
 var community=$("communitySection");if(community&&!community.dataset.cbFeaturePage)community.style.display="none";
 if(techniques)techniques.style.display=(paywallMode==="off"||premiumAllowed())?"inline-flex":"none";
 var admin=$("developerNav");if(admin)admin.textContent="Admin";
}
var previousPlanningGate=window.updatePlanningGate;
window.updatePlanningGate=function(){
 if(typeof previousPlanningGate==="function")previousPlanningGate();
 syncNavControls();
};
var previousAccountUpdate=window.updateAccount;
window.updateAccount=function(customer){
 if(typeof previousAccountUpdate==="function")previousAccountUpdate(customer);
 if(customer)currentCustomer=customer;
 syncNavControls();
};
var previousKrogerCheck=window.checkKroger;
window.checkKroger=async function(){
 if(typeof previousKrogerCheck==="function")await previousKrogerCheck();
 syncNavControls();
 return !!krogerConnected;
};
var previousLogout=window.logoutAccount;
window.logoutAccount=async function(){
 if(typeof previousLogout==="function")await previousLogout();
 syncNavControls();
};
var previousRewardLoad=window.loadRewardStatus;
window.loadRewardStatus=async function(){
 if(typeof previousRewardLoad==="function")await previousRewardLoad();
 syncNavControls();
};
window.loadDeveloperPaywall=async function(){
 try{
  var data=await api("/api/admin/settings");
  paywallMode=["real","demo","off"].includes(data.paywallMode)?data.paywallMode:(data.paywallEnabled?"real":"off");
  stripeConfigured=!!data.stripeConfigured;paywallEnabled=paywallMode!=="off";
  syncPaywallButtons();updateSubscriptionModeUI();syncNavControls();
  if(typeof renderRecipes==="function")renderRecipes();
 }catch(e){if($("devPaywallMsg"))$("devPaywallMsg").textContent=e.message}
};
window.setPaywallMode=async function(mode){
 if(!["real","demo","off"].includes(mode))return;
 try{
  var data=await api("/api/admin/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paywallMode:mode})});
  paywallMode=data.paywallMode;stripeConfigured=!!data.stripeConfigured;paywallEnabled=paywallMode!=="off";
  syncPaywallButtons();updateSubscriptionModeUI();syncNavControls();
  if(typeof renderRecipes==="function")renderRecipes();
  if($("recipePage")?.classList.contains("open")&&selectedRecipe&&typeof window.openRecipePage==="function")window.openRecipePage(selectedRecipe);
  if(paywallMode==="off"&&$("techniqueLibrary")?.style.display==="block")window.openTechniqueLibrary();
  if(typeof status==="function")status("Access mode changed to "+(mode==="off"?"No Paywall":mode==="demo"?"Fake Paywall":"Real Paywall")+".","ok");
 }catch(e){if(typeof status==="function")status(e.message,"err")}
};
window.setPaywall=async function(enabled){return window.setPaywallMode(enabled?"real":"off")};
window.openTechniqueLibrary=async function(){
 if(paywallMode!=="off"&&!premiumAllowed()){
  if(typeof openSubscription==="function")openSubscription();
  if(typeof status==="function")status("Technique videos require a membership in the current paywall mode.","ok");
  return;
 }
 $("homeMain")?.classList.remove("hidden");
 if($("techniqueLibrary"))$("techniqueLibrary").style.display="block";
 $("techniqueLibrary")?.scrollIntoView({behavior:"smooth"});
 if(typeof loadMemberTechniques==="function")await loadMemberTechniques();
};
function applyPaywallRecipePreview(recipeId){
 if(!paywallEnabled||premiumAllowed())return;
 var recipe=typeof recipes!=="undefined"?recipes[recipeId]:null,page=$("recipePage");
 if(!recipe||!page||!page.classList.contains("open"))return;
 var firstCard=page.querySelector(".detailGrid .detailCard");
 if(!firstCard)return;
 var heading=firstCard.querySelector("h2");
 if(heading)heading.textContent="Ingredients · preview";
 firstCard.querySelectorAll(".ingredientList,.recipePreviewIngredients,.recipePreviewCount,.recipeAccessGate").forEach(function(node){node.remove()});
 var previewBox=document.createElement("div");previewBox.className="recipePreviewIngredients";
 (recipe.ingredients||[]).slice(0,3).forEach(function(item){var chip=document.createElement("span");chip.textContent=String(item[0]||"Ingredient");previewBox.appendChild(chip)});
 if(heading)heading.insertAdjacentElement("afterend",previewBox);
 var remaining=Math.max(0,(recipe.ingredients||[]).length-3),count=document.createElement("div");count.className="recipePreviewCount";
 count.textContent=remaining?remaining+" more ingredients and all quantities are hidden until membership is unlocked.":"This is a three-ingredient preview.";
 previewBox.insertAdjacentElement("afterend",count);
 var howHeading=Array.from(firstCard.querySelectorAll("h2")).find(function(x){return x.textContent.toLowerCase().includes("how to cook")});
 if(howHeading){
  var container=howHeading.parentElement;
  Array.from(container.children).forEach(function(child){if(child!==howHeading)child.remove()});
  var list=document.createElement("div");list.className="stepList";
  (recipe.instructions||[]).slice(0,2).forEach(function(instruction,index){
   var step=document.createElement("div");step.className="step";
   var number=document.createElement("div");number.className="stepNum";number.textContent=String(index+1);
   var copy=document.createElement("div");copy.textContent=instruction;
   step.append(number,copy);list.appendChild(step);
  });
  container.appendChild(list);
  var note=document.createElement("p");note.className="muted";note.textContent="Free preview: 2 cooking steps and 3 ingredients. Unlock the membership to view the complete recipe.";container.appendChild(note);
  var gate=document.createElement("div");gate.className="recipeAccessGate";
  var gateTitle=document.createElement("h3");gateTitle.textContent="Unlock the complete recipe";
  var gateText=document.createElement("p");gateText.textContent="Get all ingredients, quantities, cooking steps, tips and member video lessons.";
  var gateButton=document.createElement("button");gateButton.type="button";gateButton.className="btn primary";gateButton.textContent="Explore membership";gateButton.addEventListener("click",function(){if(typeof openSubscription==="function")openSubscription()});
  gate.append(gateTitle,gateText,gateButton);container.appendChild(gate);
 }
 var primary=page.querySelector(".recipeHeroContent .actions .btn.primary");
 if(primary){primary.textContent="Unlock full recipe";primary.onclick=function(){if(typeof openSubscription==="function")openSubscription()}}
}
var previousRecipeOpen=window.openRecipePage;
window.openRecipePage=function(id){
 if(typeof previousRecipeOpen==="function")previousRecipeOpen(id);
 setTimeout(function(){decorateRecipePage(id);applyPaywallRecipePreview(id)},0);
};
window.startCookingMode=function(recipeId){
 var recipe=typeof recipes!=="undefined"?recipes[recipeId]:null;
 if(!recipe)return;
 if(!currentCustomer&&paywallMode!=="off"){if(typeof openAccount==="function")openAccount();return}
 cookRecipeId=recipeId;
 cookSteps=paywallEnabled&&!premiumAllowed()?(recipe.instructions||[]).slice(0,2):(recipe.instructions||[]).slice();
 cookStep=0;if(!cookSteps.length)return;
 ensureCookOverlay();$("cbCookTitle").textContent=recipe.name+" · Cooking mode";resetCookTimer();renderCookStep();$("cbCookOverlay").classList.add("open");
};
window.redeemDemoReward=function(rewardId,cost,title){
 var statusBox=$("cbRewardShopStatus");
 if(!currentCustomer){if(statusBox)statusBox.textContent="Sign in to preview reward redemption.";if(typeof openAccount==="function")openAccount();return}
 var points=Number(currentCustomer.points||0);
 if(points<Number(cost)){if(statusBox)statusBox.textContent="You need "+(Number(cost)-points).toLocaleString()+" more points to try "+title+" in the demo shop.";return}
 if(statusBox)statusBox.textContent="Demo redemption complete: "+title+". No order was placed, nothing will be shipped, and your points were not deducted in this presentation shop.";
 if(typeof status==="function")status("Demo reward preview: "+title+". No real order was created.","ok");
};

function initializeMajorUpdate(){
 buildAccountModeTabs();ensureCookOverlay();ensureHouseholdPanel();enhanceStoreField();showStoreDisclaimer();ensureCommunitySection();
 loadPaywallMode();refreshCommunity();renderSmartCombos();ensureFeatureDirectory();watchRecipeGrid();syncNavControls();
 var featureStrip=$("featureStrip");
 if(featureStrip){var routes=["guided","techniques","shopping","learning"];Array.from(featureStrip.querySelectorAll(".feature")).forEach(function(card,i){card.setAttribute("role","button");card.setAttribute("tabindex","0");card.dataset.cbFeatureRoute=routes[i]||"learning";card.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();openFeaturePage(card.dataset.cbFeatureRoute)}})})}
 if($("learn"))$("learn").style.display="none";if($("account"))$("account").style.display="none";

 if(currentCustomer){refreshHousehold();applySavedZipAndStore()}
 var app=document.querySelector("#accountModal .modalCard");if(app){app.addEventListener("keydown",function(e){if(e.key==="Enter"&&e.target.tagName==="INPUT"&&e.target.id!=="accountPasswordConfirm"){e.preventDefault();if($("cbAccountModeTabs")?.querySelector("button.active")?.dataset.mode==="signup")window.registerAccount();else window.loginAccount()}})}
 if(new URLSearchParams(location.search).get("payment")==="success"){if(typeof status==="function")status("Payment completed. Your membership will unlock after Stripe confirms the subscription.","ok");history.replaceState({},document.title,location.pathname)}
 if(new URLSearchParams(location.search).get("payment")==="cancelled"){if(typeof status==="function")status("Checkout was cancelled. No membership payment was completed.","")}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initializeMajorUpdate);else initializeMajorUpdate();
window.addEventListener("focus",function(){if(currentCustomer)refreshHousehold()});
document.addEventListener("click",function(e){
 var back=e.target.closest("[data-cb-back]");if(back){closeFeaturePage();return}
 var feature=e.target.closest("[data-cb-feature-route]");if(feature){openFeaturePage(feature.dataset.cbFeatureRoute);return}
 var quiz=e.target.closest("[data-cb-quiz]");if(quiz){if(typeof window.openPreferences==="function")window.openPreferences();return}
 var explore=e.target.closest("[data-cb-explore]");if(explore)handleExploreAction(explore.dataset.cbExplore);
 var combo=e.target.closest("[data-combo-a]");if(combo){var a=recipes[combo.dataset.comboA],b=recipes[combo.dataset.comboB];if(a&&b){var r=makeComboRecipe(a,b);recipes[r.id]=r;window.openRecipePage(r.id)}}
 var open=e.target.closest("[data-community-open]");if(open)window.openRecipePage(open.dataset.communityOpen);
 var favorite=e.target.closest("[data-community-fav]");if(favorite)toggleCommunityFavorite(favorite.dataset.communityFav);
});
})();
