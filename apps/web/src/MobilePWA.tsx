import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  approveContentRequest,
  createContentRequest,
  getDashboard,
  getSessionToken,
  listContentRequests,
  logoutAccount,
} from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

const planLabels: Record<string, string> = {
  trial: "Teste gratuito",
  start: "MODO Começar",
  presenca: "MODO Presença",
  pro: "MODO Crescer",
  business: "MODO Business",
  agency_professional: "MODO Agency Professional",
  agency_studio: "MODO Agency Studio",
  agency: "MODO Agency",
};

const statusLabels: Record<string, string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Em revisão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const objectives = [
  ["autoridade", "Construir autoridade", "Ensinar e fortalecer posicionamento."],
  ["demanda", "Atrair oportunidades", "Gerar interesse e novas conversas."],
  ["conversao", "Divulgar uma oferta", "Apresentar valor e orientar a próxima ação."],
  ["educacao", "Explicar um tema", "Organizar uma ideia de forma útil e clara."],
  ["relacionamento", "Manter presença", "Criar proximidade e continuidade."],
] as const;

const formats = [
  ["static_post", "Post com imagem", ["Instagram", "Facebook", "LinkedIn"]],
  ["carousel", "Carrossel", ["Instagram", "Facebook", "LinkedIn"]],
  ["story", "Stories", ["Instagram", "Facebook"]],
  ["short_video_script", "Roteiro curto", ["Instagram", "Facebook", "LinkedIn"]],
  ["channel_adaptation", "Texto longo", ["LinkedIn"]],
] as const;

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "você";
}

function BrandMark() {
  return <div className="modo-native-brand"><span>M</span><i /></div>;
}

function Pill({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "purple" | "neutral" | "warning" }) {
  return <span className={"modo-native-pill " + tone}>{children}</span>;
}

function NativeHeader({ dashboard }: { dashboard: Dashboard }) {
  return <header className="modo-native-header"><BrandMark /><div><strong>{dashboard.usage.creditsRemaining}</strong><small>créditos</small></div></header>;
}

function statusTone(status: string) {
  if (status === "approved" || status === "published") return "green" as const;
  if (status === "failed" || status === "cancelled") return "warning" as const;
  return "neutral" as const;
}

function Home({ dashboard, recent }: { dashboard: Dashboard; recent: ContentRequest[] }) {
  const activeBrand = dashboard.brands[0];
  return <>
    <NativeHeader dashboard={dashboard} />
    <section className="modo-native-hero">
      <Pill tone="green">{planLabels[dashboard.usage.plan] || "MODO"}</Pill>
      <h1>Olá, {firstName(dashboard.user.name)}.</h1>
      <p>A MODO já conhece <strong>{activeBrand?.name || dashboard.organization.name}</strong>. Escolha o resultado que você precisa agora.</p>
    </section>
    <section className="modo-native-modules">
      <a className="modo-native-module social" href="/app/mobile/create?channel=Instagram"><Pill>INSTAGRAM E FACEBOOK</Pill><b>◎</b><h2>Crie presença visual.</h2><p>Posts, imagens, carrosséis, stories e campanhas construídos com o contexto da sua marca.</p><strong>Começar criação →</strong></a>
      <a className="modo-native-module linkedin" href="/app/mobile/create?channel=LinkedIn"><Pill tone="green">LINKEDIN</Pill><b>in</b><h2>Transforme intenção em autoridade.</h2><p>Posts, artigos, documentos e ideias profissionais alinhados ao seu posicionamento.</p><strong>Criar para LinkedIn →</strong></a>
      <button className="modo-native-module intelligence" onClick={() => alert("Inteligência MODO\n\nA demonstração guiada de concorrentes, leads e sinais de mercado será liberada progressivamente no aplicativo. Suas pesquisas avançadas permanecem sincronizadas com a plataforma MODO.")}><Pill tone="purple">DEMONSTRAÇÃO</Pill><b>✦</b><h2>Descubra sinais antes de decidir.</h2><p>Uma prévia controlada de concorrentes, oportunidades e potenciais leads, sem ações automáticas.</p><strong>Entender a inteligência →</strong></button>
    </section>
    <section className="modo-native-section">
      <div className="modo-native-sectionhead"><div><small>PRODUÇÃO RECENTE</small><h2>Continue de onde parou</h2></div><a href="/app/mobile/agenda">Ver agenda</a></div>
      {recent.length ? recent.slice(0, 3).map((item) => <article className="modo-native-recent" key={item.id}><div><Pill tone={statusTone(item.status)}>{statusLabels[item.status] || item.status}</Pill><small>{item.channel}</small></div><h3>{item.output?.title || item.brief}</h3><p>{item.output?.caption || "A MODO está preparando texto e direção visual."}</p></article>) : <div className="modo-native-empty"><b>✦</b><h3>Sua primeira criação começa aqui</h3><p>Conte o objetivo. A MODO recomenda o formato e prepara uma entrega para sua revisão.</p><a href="/app/mobile/create">Criar agora</a></div>}
    </section>
  </>;
}

function Create({ dashboard, onRefresh }: { dashboard: Dashboard; onRefresh: () => Promise<void> }) {
  const initial = new URLSearchParams(location.search).get("channel");
  const [brandId, setBrandId] = useState(dashboard.brands[0]?.id || "");
  const [channel, setChannel] = useState(["Instagram","Facebook","LinkedIn"].includes(initial || "") ? String(initial) : "Instagram");
  const [objective, setObjective] = useState("autoridade");
  const [contentType, setContentType] = useState("static_post");
  const [brief, setBrief] = useState("");
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const available = formats.filter(([, , channels]) => (channels as readonly string[]).includes(channel));

  useEffect(() => {
    if (!available.some(([id]) => id === contentType)) setContentType(String(available[0]?.[0] || "static_post"));
  }, [channel]);

  async function create() {
    if (brief.trim().length < 10 || !brandId) return;
    setBusy(true); setMessage("");
    try {
      const selected = formats.find(([id]) => id === contentType);
      const instruction = contentType === "channel_adaptation" ? "Produza um texto longo para LinkedIn, com estrutura editorial, subtítulos curtos e conclusão prática.\n\n" : "";
      const result = await createContentRequest({ brandId, channel, objective, contentType, brief: instruction + brief.trim() } as any);
      setRequest(result.request);
      setMessage("A MODO está preparando texto, direção visual e entrega para sua revisão.");
      await onRefresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível criar."); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!request) return;
    setBusy(true);
    try { setRequest(await approveContentRequest(request.id)); setMessage("Entrega aprovada. Agora ela está pronta para publicação ou agendamento."); await onRefresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível aprovar."); }
    finally { setBusy(false); }
  }

  return <>
    <NativeHeader dashboard={dashboard} />
    <div className="modo-native-heading"><small>MODO CREATE</small><h1>Crie com contexto. Revise antes de publicar.</h1><p>Escolha canal, resultado e formato. A MODO usa a marca ativa como contexto.</p></div>
    {message && <div className="modo-native-notice">{message}</div>}
    <section className="modo-native-card">
      <label>Contexto ativo</label><div className="modo-native-options">{dashboard.brands.map(b => <button className={brandId === b.id ? "selected" : ""} onClick={() => setBrandId(b.id)} key={b.id}>{b.name}</button>)}</div>
      <label>Canal</label><div className="modo-native-options">{["Instagram","Facebook","LinkedIn"].map(x => <button className={channel === x ? "selected" : ""} onClick={() => setChannel(x)} key={x}>{x}</button>)}</div>
      <label>Resultado desejado</label><div className="modo-native-objectives">{objectives.map(([id,title,copy]) => <button className={objective === id ? "selected" : ""} onClick={() => setObjective(id)} key={id}><b>{title}</b><span>{copy}</span></button>)}</div>
      <label>Formato recomendado</label><div className="modo-native-options">{available.map(([id,title]) => <button className={contentType === id ? "selected" : ""} onClick={() => setContentType(id)} key={id}>{title}</button>)}</div>
      <label>Conte a intenção, novidade ou material de partida</label><textarea value={brief} onChange={e => setBrief(e.target.value)} placeholder="Ex.: Quero apresentar nosso novo serviço, explicar para quem ele serve e convidar as pessoas para uma conversa." />
      <div className="modo-native-cost"><span>Custo desta criação</span><Pill tone="green">{contentType === "carousel" ? 2 : 1} crédito{contentType === "carousel" ? "s" : ""}</Pill></div>
      <button className="modo-native-primary" disabled={busy || brief.trim().length < 10} onClick={create}>{busy ? "Preparando..." : "Criar para revisão"}</button>
    </section>
    {request && <section className="modo-native-card modo-native-delivery"><div className="modo-native-row"><div><small>ENTREGA</small><h2>{request.output?.title || "Produção em andamento"}</h2></div><Pill tone={statusTone(request.status)}>{statusLabels[request.status] || request.status}</Pill></div>{request.output?.imageUrl && <img src={request.output.imageUrl} alt={request.output.imageAlt || "Imagem criada pela MODO"} />}{request.output?.caption && <div className="modo-native-output"><small>TEXTO</small><p>{request.output.caption}</p></div>}{request.output?.cta && <div className="modo-native-output"><small>CHAMADA</small><p>{request.output.cta}</p></div>}{request.status === "ready" && <button className="modo-native-primary" onClick={approve} disabled={busy}>Aprovar entrega</button>}{request.status === "approved" && <a className="modo-native-secondary" href="/app/mobile/agenda">Ver na Agenda</a>}</section>}
  </>;
}

async function mobileApi(path: string, init?: RequestInit) {
  const token = getSessionToken();
  const res = await fetch(API_URL + path, { ...init, headers: { authorization: "Bearer " + token, ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Não foi possível concluir.");
  return data;
}

function Video({ dashboard, recent, onRefresh }: { dashboard: Dashboard; recent: ContentRequest[]; onRefresh: () => Promise<void> }) {
  const [brandId, setBrandId] = useState(dashboard.brands[0]?.id || "");
  const [brief, setBrief] = useState("");
  const [objective, setObjective] = useState("demanda");
  const [duration, setDuration] = useState(30);
  const [captions, setCaptions] = useState(true);
  const [voiceover, setVoiceover] = useState(false);
  const [request, setRequest] = useState<ContentRequest | null>(() => recent.find(x => x.contentType === "short_video_script") || null);
  const [project, setProject] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [workingScene, setWorkingScene] = useState<number | null>(null);
  const [provider, setProvider] = useState<"instagram"|"facebook">("instagram");
  const [connections, setConnections] = useState<any[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);

  useEffect(() => { if (request?.id) mobileApi("/api/v1/video-projects/by-content/" + encodeURIComponent(request.id)).then(x => setProject(x.project || null)).catch(() => undefined); }, [request?.id]);

  async function script() {
    if (brief.trim().length < 10) return;
    setBusy(true); setMessage("");
    try {
      const result = await createContentRequest({ brandId, channel: "Instagram", objective, contentType: "short_video_script", brief: "Crie um roteiro de vídeo vertical 9:16 pensado para Reel. Objetivo principal: " + brief.trim() } as any);
      setRequest(result.request); setProject(null); setMessage("A MODO está transformando seu objetivo em roteiro e direção visual."); await onRefresh();
    } catch(e){setMessage(e instanceof Error?e.message:"Não foi possível iniciar o vídeo.");} finally{setBusy(false)}
  }
  async function approveScript(){if(!request)return;setBusy(true);try{setRequest(await approveContentRequest(request.id));setMessage("Roteiro aprovado. Agora a MODO pode montar o primeiro corte.");}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível aprovar.");}finally{setBusy(false)}}
  async function build(){if(!request)return;setBusy(true);try{const d=await mobileApi("/api/v1/video-projects",{method:"POST",body:JSON.stringify({contentRequestId:request.id,durationSeconds:duration,captions,voiceover})});setProject(d.project);setMessage("Primeiro corte iniciado. Você pode sair desta aba e voltar depois.");}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível montar o Reel.");}finally{setBusy(false)}}
  async function refreshProject(){if(!project?.id)return;try{const d=await mobileApi("/api/v1/video-projects/"+encodeURIComponent(project.id));setProject(d.project);}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível atualizar o Reel.");}}
  async function regenerateScene(sceneIndex:number){if(!project)return;setWorkingScene(sceneIndex);try{const d=await mobileApi("/api/v1/video-projects/"+encodeURIComponent(project.id)+"/scenes/"+sceneIndex+"/regenerate",{method:"POST",body:"{}"});setProject(d.project);setMessage("Cena "+sceneIndex+": a MODO está buscando uma nova alternativa visual.");}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível trocar esta cena.");}finally{setWorkingScene(null)}}
  async function approveScene(sceneIndex:number){if(!project)return;setWorkingScene(sceneIndex);try{const d=await mobileApi("/api/v1/video-projects/"+encodeURIComponent(project.id)+"/scenes/"+sceneIndex+"/approve",{method:"POST",body:"{}"});setProject(d.project);}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível aprovar esta cena.");}finally{setWorkingScene(null)}}
  async function approveFinal(){if(!project)return;setBusy(true);try{const d=await mobileApi("/api/v1/video-projects/"+encodeURIComponent(project.id)+"/approve",{method:"POST",body:"{}"});setProject(d.project);setMessage("Reel aprovado. Agora ele está liberado para o Publisher.");await refreshConnections();}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível aprovar o Reel final.");}finally{setBusy(false)}}
  async function retryRender(){if(!project)return;setBusy(true);try{const d=await mobileApi("/api/v1/video-projects/"+encodeURIComponent(project.id)+"/retry",{method:"POST",body:"{}"});setProject(d.project);}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível tentar o render novamente.");}finally{setBusy(false)}}
  async function refreshConnections(){if(!brandId)return;setLoadingConnections(true);try{const d=await mobileApi("/api/v2/publisher/connections?brandId="+encodeURIComponent(brandId));setConnections(d.connections||[]);}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível carregar suas redes.");}finally{setLoadingConnections(false)}}
  async function connectProvider(){if(!brandId)return;setBusy(true);try{const d=await mobileApi("/api/v2/publisher/connect/"+provider,{method:"POST",body:JSON.stringify({brandId})});if(d.authorizationUrl)location.href=d.authorizationUrl;else throw new Error("O provedor não retornou a tela de autorização.");}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível abrir a conexão social.");}finally{setBusy(false)}}
  async function publish(){if(!project||!request)return;const connection=connections.find(x=>x.provider===provider&&x.connected&&x.canPublish);if(!connection){setMessage("Conecte uma conta de "+(provider==="instagram"?"Instagram":"Facebook")+" antes de publicar.");return;}setBusy(true);try{const d=await mobileApi("/api/v2/publisher/publications",{method:"POST",body:JSON.stringify({contentRequestId:request.id,brandId:request.brandId,provider,connectionId:connection.id,videoProjectId:project.id,mode:"now",idempotencyKey:"pwa-video-"+project.id+"-"+provider})});const publication=d.publication||d;setMessage(publication.status==="published"?"Publicado com sucesso.":"Publicação enviada ao Publisher. A MODO acompanha a entrega.");}catch(e){setMessage(e instanceof Error?e.message:"Não foi possível publicar o Reel.");}finally{setBusy(false)}}

  return <>
    <NativeHeader dashboard={dashboard} />
    <div className="modo-native-video-top"><Pill tone="purple">MODO VIDEO</Pill></div>
    <div className="modo-native-heading"><small>DO OBJETIVO AO PRIMEIRO CORTE</small><h1>Crie um Reel sem montar a edição do zero.</h1><p>A MODO prepara roteiro, direção visual e primeiro corte para sua aprovação.</p></div>
    {message && <div className="modo-native-notice">{message}</div>}
    {!request && <section className="modo-native-card"><h2>1. O que este Reel precisa fazer?</h2><label>Objetivo em linguagem simples</label><textarea value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Ex.: apresentar a MODO para empresários que perdem tempo editando conteúdo."/><label>Resultado principal</label><div className="modo-native-options">{objectives.slice(0,4).map(([id,title])=><button key={id} className={objective===id?"selected":""} onClick={()=>setObjective(id)}>{title}</button>)}</div><button className="modo-native-primary" onClick={script} disabled={busy||brief.trim().length<10}>Criar roteiro com a MODO</button></section>}
    {request && <section className="modo-native-card"><div className="modo-native-row"><div><h2>2. Estratégia e roteiro</h2><small>{statusLabels[request.status]||request.status}</small></div><Pill tone={request.status==="approved"?"green":"blue"}>{request.status==="approved"?"APROVADO":"EM PRODUÇÃO"}</Pill></div><h3>{request.output?.title||request.brief}</h3>{request.output?.hook ? <blockquote>“{request.output.hook}”</blockquote>:<p>A MODO está escrevendo o gancho, a sequência de cenas e a chamada final.</p>}{request.status==="ready"&&<button className="modo-native-primary" onClick={approveScript} disabled={busy}>Aprovar roteiro</button>}<button className="modo-native-secondary" onClick={()=>{setRequest(null);setProject(null)}}>Começar outro vídeo</button></section>}
    {request?.status==="approved"&&!project&&<section className="modo-native-card"><h2>3. Monte o primeiro corte</h2><p>A direção criativa já está definida. Escolha apenas duração, legenda e voz.</p><label>Duração</label><div className="modo-native-options">{[15,30,45].map(x=><button className={duration===x?"selected":""} onClick={()=>setDuration(x)} key={x}>{x}s</button>)}</div><label className="modo-native-toggle"><input type="checkbox" checked={captions} onChange={e=>setCaptions(e.target.checked)}/><span><b>Legendas no vídeo</b><small>Prontas para consumo sem som.</small></span></label><label className="modo-native-toggle"><input type="checkbox" checked={voiceover} onChange={e=>setVoiceover(e.target.checked)}/><span><b>Narração PT-BR</b><small>Voz por IA sincronizada com as cenas.</small></span></label><button className="modo-native-primary" onClick={build} disabled={busy}>Gerar Reel</button></section>}
    {project&&<><section className="modo-native-card"><div className="modo-native-row"><div><h2>Primeiro corte</h2><small>{project.status} · {project.durationSeconds}s · 9:16</small></div><Pill tone={project.status==="ready"?"green":project.status==="failed"?"warning":"purple"}>{String(project.status).toUpperCase()}</Pill></div>{project.outputUrl&&<video className="modo-native-video" src={project.outputUrl} controls playsInline/>}{project.status==="failed"?<button className="modo-native-primary" onClick={retryRender} disabled={busy}>Tentar render novamente</button>:<button className="modo-native-secondary" onClick={refreshProject}>Atualizar primeiro corte</button>}</section>{project.status==="ready"&&<section className="modo-native-storyboard"><div className="modo-native-heading"><small>STORYBOARD</small><h1>Aprove cena por cena</h1><p>Se uma cena não estiver boa, troque só ela. O restante do Reel fica preservado.</p></div>{(project.scenes||[]).map((scene:any)=>{const review=project.review?.scenes?.find((x:any)=>x.sceneIndex===scene.index);const approved=review?.status==="approved";return <article className="modo-native-card modo-native-scene" key={scene.index}><div className="modo-native-row"><Pill tone={approved?"green":"neutral"}>CENA {scene.index}</Pill><small>{scene.visualType||"visual"}</small></div>{scene.imageUrl&&<img src={scene.imageUrl} alt=""/>}{scene.videoUrl&&<video src={scene.videoUrl} controls playsInline/>}<h3>{scene.headline}</h3><p>{scene.caption}</p><div className="modo-native-scene-actions">{!approved&&<button className="modo-native-secondary" onClick={()=>regenerateScene(scene.index)} disabled={workingScene===scene.index}>Outro visual</button>}{!approved?<button className="modo-native-primary" onClick={()=>approveScene(scene.index)} disabled={workingScene===scene.index}>Aprovar cena</button>:<span className="modo-native-approved">✓ Cena aprovada</span>}</div></article>})}</section>}{project.status==="ready"&&<section className="modo-native-card"><h2>Aprovação final</h2><p>{(project.review?.scenes||[]).filter((x:any)=>x.status==="approved").length}/{(project.scenes||[]).length} cenas aprovadas. A publicação só é liberada depois da sua aprovação final.</p>{project.review?.approvalStatus==="approved"?<Pill tone="green">REEL APROVADO</Pill>:<button className="modo-native-primary" onClick={approveFinal} disabled={busy||(project.review?.scenes||[]).filter((x:any)=>x.status==="approved").length!==(project.scenes||[]).length}>Aprovar Reel final</button>}</section>}{project.review?.approvalStatus==="approved"&&<section className="modo-native-card"><h2>Publicar</h2><p>Escolha a rede. A MODO envia o MP4 aprovado pelo Publisher V2.</p><div className="modo-native-options"><button className={provider==="instagram"?"selected":""} onClick={()=>setProvider("instagram")}>Instagram</button><button className={provider==="facebook"?"selected":""} onClick={()=>setProvider("facebook")}>Facebook</button></div>{connections.some((x:any)=>x.provider===provider&&x.connected&&x.canPublish)?<div className="modo-native-notice">✓ {(connections.find((x:any)=>x.provider===provider&&x.connected&&x.canPublish)?.displayName)||"Conta conectada"}</div>:<p>Nenhuma conta publicável carregada.</p>}<div className="modo-native-scene-actions"><button className="modo-native-secondary" onClick={refreshConnections} disabled={loadingConnections}>{loadingConnections?"Atualizando...":"Atualizar contas"}</button>{connections.some((x:any)=>x.provider===provider&&x.connected&&x.canPublish)?<button className="modo-native-primary" onClick={publish} disabled={busy}>Publicar Reel agora</button>:<button className="modo-native-primary" onClick={connectProvider} disabled={busy}>Conectar {provider==="instagram"?"Instagram":"Facebook"}</button>}</div></section>}</>}
  </>;
}

function Agenda({ dashboard, recent }: { dashboard: Dashboard; recent: ContentRequest[] }) {
  const [filter, setFilter] = useState("active");
  const filtered = recent.filter(item => filter === "all" ? true : filter === "approved" ? item.status === "approved" : ["queued","processing","ready","revision_requested"].includes(item.status));
  return <>
    <NativeHeader dashboard={dashboard} />
    <div className="modo-native-heading"><small>AGENDA E PUBLICAÇÃO</small><h1>Sua produção em um só lugar.</h1><p>Acompanhe criação, aprovação, agendamentos e o que já foi publicado diretamente pela MODO.</p></div>
    <div className="modo-native-sectionhead"><div><small>CRIAÇÃO E APROVAÇÃO</small><h2>Produção</h2></div></div>
    <div className="modo-native-options">{[["active","Em andamento"],["approved","Aprovados"],["all","Todos"]].map(([id,label])=><button key={id} className={filter===id?"selected":""} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    <section className="modo-native-agenda">{filtered.length?filtered.map(item=><article className="modo-native-recent" key={item.id}><div><Pill tone={statusTone(item.status)}>{statusLabels[item.status]||item.status}</Pill><small>{new Date(item.createdAt).toLocaleDateString("pt-BR")}</small></div><div className="modo-native-agenda-body">{item.output?.imageUrl?<img src={item.output.imageUrl} alt=""/>:<span>✦</span>}<div><small>{item.channel.toUpperCase()} · {item.contentType}</small><h3>{item.output?.title||item.brief}</h3><p>{item.output?.caption||"Texto e visual em preparação."}</p></div></div>{item.status==="approved"&&item.output?.caption&&<button className="modo-native-secondary" onClick={()=>navigator.clipboard.writeText(item.output!.caption!)}>Copiar texto aprovado</button>}</article>):<div className="modo-native-empty"><b>✦</b><h3>{filter==="active"?"Nenhuma produção em andamento":filter==="approved"?"Nenhum conteúdo aprovado ainda":"Seu histórico aparecerá aqui"}</h3></div>}</section>
  </>;
}

function Account({ dashboard }: { dashboard: Dashboard }) {
  const status = dashboard.usage.status || "active";
  return <>
    <div className="modo-native-account-top"><BrandMark/><Pill tone="neutral">VERSÃO 1.0.2</Pill></div>
    <div className="modo-native-heading"><small>SUA CONTA</small><h1>{dashboard.user.name}</h1><p>{dashboard.user.email}</p></div>
    <section className="modo-native-card"><div className="modo-native-row"><div><small>PLANO SINCRONIZADO</small><h2>{planLabels[dashboard.usage.plan]||dashboard.usage.plan}</h2></div><Pill tone={status==="active"?"green":"warning"}>{String(status).toUpperCase()}</Pill></div><div className="modo-native-stats"><div><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos disponíveis</span></div><div><strong>{dashboard.brands.length}</strong><span>contextos ativos</span></div></div><p>Sua assinatura e seus direitos de uso são sincronizados com a conta MODO. O aplicativo não abre checkout externo.</p></section>
    <section className="modo-native-card"><small>PRIVACIDADE E SUPORTE</small><a className="modo-native-account-link" href="/politica-de-privacidade">Política de Privacidade <span>›</span></a><a className="modo-native-account-link" href="/exclusao-de-dados">Excluir conta e dados <span>›</span></a></section>
    <section className="modo-native-card"><small>CONTROLE DA CONTA</small><p>Você pode iniciar a exclusão pelo aplicativo. O pedido usa o e-mail autenticado e precisa ser confirmado para impedir exclusões indevidas.</p><a className="modo-native-danger" href="/exclusao-de-dados">Iniciar pedido de exclusão</a></section>
    <button className="modo-native-secondary full" onClick={async()=>{await logoutAccount();location.href="/app";}}>Sair deste dispositivo</button><footer className="modo-native-footer">MODO · Alternative Ventures · Presença digital com contexto e aprovação.</footer>
  </>;
}

export default function MobilePWA() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [recent, setRecent] = useState<ContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const route = useMemo(() => {
    const path = location.pathname.replace(/\/$/, "");
    if (path.endsWith("/create")) return "create";
    if (path.endsWith("/video")) return "video";
    if (path.endsWith("/agenda")) return "agenda";
    if (path.endsWith("/account")) return "account";
    return "home";
  }, []);

  async function refreshData() {
    const [nextDashboard, requests] = await Promise.all([getDashboard(), listContentRequests()]);
    if (!nextDashboard.brands.length) { location.replace("/app/onboarding"); return; }
    setDashboard(nextDashboard); setRecent(requests);
  }

  useEffect(() => {
    if (!getSessionToken()) { location.replace("/app"); return; }
    let active=true;
    refreshData().catch(caught=>active&&setError(caught instanceof Error?caught.message:"Não foi possível abrir a MODO.")).finally(()=>active&&setLoading(false));
    return()=>{active=false};
  }, []);

  if (loading) return <main className="modo-native-shell modo-native-loading"><BrandMark/><div className="portal-spinner"/><p>Preparando sua MODO...</p></main>;
  if (!dashboard) return <main className="modo-native-shell modo-native-loading"><BrandMark/><p>{error||"Sua sessão expirou."}</p><a href="/app">Entrar novamente</a></main>;

  return <main className="modo-native-shell">
    {route==="home"&&<Home dashboard={dashboard} recent={recent}/>}
    {route==="create"&&<Create dashboard={dashboard} onRefresh={refreshData}/>}
    {route==="video"&&<Video dashboard={dashboard} recent={recent} onRefresh={refreshData}/>}
    {route==="agenda"&&<Agenda dashboard={dashboard} recent={recent}/>}
    {route==="account"&&<Account dashboard={dashboard}/>}
  </main>;
}
