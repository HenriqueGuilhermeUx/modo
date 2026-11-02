import { useEffect, useState, type FormEvent } from "react";
import { getDashboard, getSessionToken } from "./api";

const API=(import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/,"");
const themes=[["purple","Roxo MODO"],["blue","Azul"],["dark","Grafite"],["green","Verde"]];
const styles=[["clean","Minimalista"],["frame","Moldura"],["spotlight","Destaque"]];
export default function VideoLabCommercial() {
  const [fields,setFields]=useState({title:"Sua ideia vira vídeo",subtitle:"Criado com MODO",scene2:"Transforme ideias em resultados",scene3:"Comece agora",theme:"purple",style:"clean"});
  const [usage,setUsage]=useState<{plan:string;status:string;creditsRemaining:number;usageByType:{short_video_script:number};entitlements:{maxShortVideoScriptsPerMonth:number}}|null>(null);
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  const [url,setUrl]=useState("");
  useEffect(()=>{if(!getSessionToken()){window.location.replace("/app");return}void getDashboard().then(d=>setUsage(d.usage)).catch(()=>setStatus("Entre novamente no MODO para continuar."));},[]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);
  const set=(key:keyof typeof fields,value:string)=>setFields(old=>({...old,[key]:value}));
  async function render(e:FormEvent) {
    e.preventDefault();
    if(!getSessionToken()){window.location.href="/app";return}
    setBusy(true);setStatus("Criando seu vídeo...");setUrl("");
    try{
      const response=await fetch(API+"/api/v1/video-lab/render",{method:"POST",headers:{"authorization":"Bearer "+getSessionToken(),"content-type":"application/json"},body:JSON.stringify(fields)});
      if(!response.ok){
        const error=await response.json().catch(()=>({message:"Não foi possível gerar o vídeo."}));
        throw Error(error.message||"Não foi possível gerar o vídeo.");
      }
      const file=await response.blob();
      if(file.type!=="video/mp4"||file.size<3000)throw Error("Resposta inválida do motor.");
      setUrl(URL.createObjectURL(file));
      setStatus("Vídeo pronto para baixar. Foram usados os créditos previstos pelo seu plano.");
      void getDashboard().then(d=>setUsage(d.usage)).catch(()=>{});
    }catch(err){setStatus(err instanceof Error?err.message:"Falha na criação do vídeo.");}finally{setBusy(false)}
  }
  const background:{[key:string]:string}={purple:"#241239",blue:"#092d58",dark:"#171923",green:"#123c35"};
  return <main style={{background:"#0b0d13",color:"#fff",minHeight:"100vh",fontFamily:"system-ui",padding:"36px 20px"}}>
    <div style={{maxWidth:840,margin:"auto"}}>
      <a href="/app/video" style={{color:"#c6b6ff"}}>← Voltar aos vídeos do MODO</a>
      <h1>MODO Video Lab</h1><p>Vídeos verticais de cinco segundos com três cenas, estilos e MP4 para download. Integrado à sua conta e aos créditos do MODO.</p>
      {usage&&<p aria-label="Saldo e plano">Plano: <b>{usage.plan}</b> · Créditos disponíveis: <b>{usage.creditsRemaining}</b> · Vídeos/roteiros curtos usados neste período: <b>{usage.usageByType.short_video_script}/{usage.entitlements.maxShortVideoScriptsPerMonth}</b></p>}
      <form onSubmit={render} style={{background:"#171a26",borderRadius:18,padding:24,display:"grid",gap:13}}>
        {([["title","Cena 1 — abertura",64],["scene2","Cena 2 — mensagem",80],["scene3","Cena 3 — encerramento",64],["subtitle","Rodapé",80]] as const).map(([key,label,max])=><label key={key}>{label}<input required={key==="title"} maxLength={max} value={fields[key]} onChange={e=>set(key,e.target.value)} style={{width:"100%",padding:12,background:"#11131d",color:"white",border:"1px solid #4d4968",borderRadius:9,boxSizing:"border-box",marginTop:6}}/></label>)}
        <label>Cor<select value={fields.theme} onChange={e=>set("theme",e.target.value)} style={{marginLeft:10}}>{themes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Estilo<select value={fields.style} onChange={e=>set("style",e.target.value)} style={{marginLeft:10}}>{styles.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <div style={{background:background[fields.theme],borderRadius:16,padding:24,textAlign:"center"}}>
          <p>{fields.title}</p><hr style={{opacity:.2}}/><p>{fields.scene2}</p><hr style={{opacity:.2}}/><p>{fields.scene3}</p><small>{fields.subtitle}</small>
        </div>
        <button type="submit" disabled={busy||!usage} style={{background:"#a58cff",padding:16,border:0,borderRadius:10,fontWeight:700,cursor:"pointer"}}>{busy?"Gerando...":"Gerar vídeo MP4 · 2 créditos"}</button>
        <p role="status">{status}</p>
        {url&&<><video src={url} controls playsInline style={{maxHeight:440,maxWidth:"100%",margin:"auto"}}/><a href={url} download="modo-video.mp4" style={{color:"#d9c9ff"}}>Baixar meu MP4</a></>}
      </form>
    </div>
  </main>;
}
