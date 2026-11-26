/* TS GHOST client. All privileged operations are enforced by Supabase RLS/RPC, not by UI role flags. */
(() => {
  const cfg = window.TS_GHOST_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const note = (el, msg, bad=false) => { if(el){el.textContent=msg;el.style.color=bad?"#ff6572":"#aaa";} };
  $("#year").textContent = new Date().getFullYear();
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    note($("#upload-note"), "Setup required: configure config.js with your Supabase URL and anon key.", true);
    $("#script-list").innerHTML = '<div class="empty-state">Supabase is not configured yet. Follow SETUP.md to connect the production database.</div>';
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });
  let session=null, profile=null, role="user", scripts=[];

  function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  async function loadSession(){
    const {data:{session:s}}=await db.auth.getSession(); session=s;
    await refreshAccount();
    db.auth.onAuthStateChange((_event,s2)=>{session=s2;setTimeout(refreshAccount,0);});
  }
  async function refreshAccount(){
    if(!session){profile=null;role="user";$("#session-label").textContent="Not signed in";$("#profile-view").textContent="Sign in to view your account.";$("#logout").hidden=true;$("#developer-tools").hidden=true;return;}
    const [{data:p},{data:r}]=await Promise.all([
      db.from("profiles").select("username,display_name,bio,created_at").eq("id",session.user.id).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id",session.user.id).maybeSingle()
    ]);
    profile=p;role=r?.role||"user";
    $("#session-label").textContent=p?.username||session.user.email;
    $("#profile-view").innerHTML=`<b>${esc(p?.display_name||p?.username||"Member")}</b><br><span class="muted">${esc(session.user.email)}</span><br><span class="tag">${esc(role.toUpperCase())}</span>`;
    $("#logout").hidden=false;$("#developer-tools").hidden=role!=="developer";
    $("#upload-note").textContent=(role==="developer"||role==="admin")?"Your account can publish scripts.":"Login required. Publishing is available to approved admins and the developer.";
    if(role==="developer") await loadApplications();
  }
  async function loadScripts(){
    const {data,error}=await db.from("scripts").select("id,title,category,version,description,file_name,storage_path,downloads,created_at,profiles(username)").eq("status","published").order("created_at",{ascending:false}).limit(100);
    if(error){$("#script-list").innerHTML='<div class="empty-state">Could not load scripts. Check database setup.</div>';return;}
    scripts=data||[];renderScripts();
    $("#stat-scripts").textContent=scripts.length;
    $("#stat-downloads").textContent=scripts.reduce((n,s)=>n+(s.downloads||0),0);
    const {count}=await db.from("profiles").select("*",{count:"exact",head:true});$("#stat-users").textContent=count??"—";
  }
  function renderScripts(){
    const q=$("#search").value.trim().toLowerCase(),cat=$("#category-filter").value;
    const rows=scripts.filter(s=>(!cat||s.category===cat)&&(!q||(s.title+" "+s.description+" "+s.category).toLowerCase().includes(q)));
    $("#script-list").innerHTML=rows.length?rows.map(s=>`<article class="script-card"><span class="tag">${esc(s.category)}</span><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p><div class="card-meta"><span>v${esc(s.version||"1.0")}</span><span>${s.downloads||0} downloads</span><span>${esc(s.profiles?.username||"Contributor")}</span></div><div class="card-actions"><button class="btn btn-red" data-download="${s.id}">Download</button></div></article>`).join(""):'<div class="empty-state">No scripts match your search.</div>';
    document.querySelectorAll("[data-download]").forEach(b=>b.addEventListener("click",()=>downloadScript(b.dataset.download)));
  }
  async function downloadScript(id){
    const s=scripts.find(x=>x.id===id);if(!s)return;
    const {data,error}=await db.storage.from("scripts").createSignedUrl(s.storage_path,60);
    if(error){alert("Download unavailable. Please contact the platform admin.");return;}
    await db.rpc("increment_script_downloads",{script_id:id});
    window.location.href=data.signedUrl;
  }
  $("#search").addEventListener("input",renderScripts);$("#category-filter").addEventListener("change",renderScripts);
  const dlg=$("#auth-dialog");let signup=false;
  $("#auth-open").onclick=()=>{dlg.showModal();};
  $("#auth-close").onclick=()=>dlg.close();
  $("#auth-switch").onclick=()=>{signup=!signup;$("#auth-title").textContent=signup?"Create account":"Sign in";$("#auth-submit").textContent=signup?"Create account":"Sign in";$("#username-wrap").hidden=!signup;$("#auth-switch").textContent=signup?"Already registered? Sign in":"Need an account? Sign up";$("#auth-form").elements.password.autocomplete=signup?"new-password":"current-password";note($("#auth-note"),"");};
  $("#auth-form").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),email=f.get("email"),password=f.get("password");
    let result;
    if(signup){
      const username=String(f.get("username")||"").toLowerCase();
      result=await db.auth.signUp({email,password,options:{data:{username}}});
      if(!result.error)note($("#auth-note"),"Account created. Check your email to confirm, then sign in.");
    }else result=await db.auth.signInWithPassword({email,password});
    if(result.error)note($("#auth-note"),result.error.message,true);
    else if(!signup){dlg.close();e.currentTarget.reset();await refreshAccount();}
  });
  $("#logout").onclick=async()=>{await db.auth.signOut();await refreshAccount();};
  $("#application-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!session){note($("#application-note"),"Please sign in first.",true);return;}
    const reason=new FormData(e.currentTarget).get("reason");
    const {error}=await db.from("admin_applications").insert({user_id:session.user.id,reason});
    note($("#application-note"),error?error.message:"Application submitted. The developer will review it.",!!error);if(!error)e.currentTarget.reset();
  });
  $("#upload-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!session){note($("#upload-note"),"Please sign in first.",true);return;}
    if(!["developer","admin"].includes(role)){note($("#upload-note"),"Only approved admins and the developer can publish scripts.",true);return;}
    const f=new FormData(e.currentTarget),file=f.get("file");
    if(!file||!file.size){note($("#upload-note"),"Choose a file first.",true);return;}
    if(file.size>50*1024*1024){note($("#upload-note"),"Maximum file size is 50 MB.",true);return;}
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const path=`${session.user.id}/${crypto.randomUUID()}-${safeName}`;
    note($("#upload-note"),"Uploading…");
    const up=await db.storage.from("scripts").upload(path,file,{upsert:false});
    if(up.error){note($("#upload-note"),up.error.message,true);return;}
    const ins=await db.from("scripts").insert({title:f.get("title"),category:f.get("category"),version:f.get("version")||"1.0",description:f.get("description"),file_name:file.name,storage_path:path,status:"published"}).select().single();
    if(ins.error){await db.storage.from("scripts").remove([path]);note($("#upload-note"),ins.error.message,true);return;}
    note($("#upload-note"),"Script published successfully.");e.currentTarget.reset();await loadScripts();
  });
  async function loadApplications(){
    const {data,error}=await db.from("admin_applications").select("id,reason,status,created_at,profiles(username)").eq("status","pending").order("created_at");
    if(error){$("#applications").textContent="Unable to load applications.";return;}
    $("#applications").innerHTML=data.length?data.map(a=>`<div class="application"><b>${esc(a.profiles?.username||"Member")}</b><p>${esc(a.reason)}</p><button class="btn btn-red" data-approve="${a.id}">Approve</button><button class="btn btn-outline" data-reject="${a.id}">Reject</button></div>`).join(""):"No pending applications.";
    document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>reviewApplication(b.dataset.approve,true));
    document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>reviewApplication(b.dataset.reject,false));
  }
  async function reviewApplication(id,approve){
    const {error}=await db.rpc("review_admin_application",{application_id:id,approve});
    if(error)alert(error.message);else await loadApplications();
  }
  loadSession().then(loadScripts);
})();