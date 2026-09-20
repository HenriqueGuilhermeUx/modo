export type VideoUseCase="fast_social"|"premium_ad"|"cinematic"|"image_to_video"|"reference_to_video";
export interface VideoModelProfile{key:string;model:string;useCases:VideoUseCase[];paid:boolean;enabled:boolean;}
export const VIDEO_MODEL_CATALOG:VideoModelProfile[]=[
 {key:"seedance_2_5",model:"bytedance/seedance-2.5/text-to-video",useCases:["fast_social","premium_ad"],paid:true,enabled:true},
 {key:"seedance_2_5_i2v",model:"bytedance/seedance-2.5/image-to-video",useCases:["image_to_video"],paid:true,enabled:false},
 {key:"seedance_2_5_r2v",model:"bytedance/seedance-2.5/reference-to-video",useCases:["reference_to_video"],paid:true,enabled:false},
 {key:"premium_video",model:"premium/provider-model",useCases:["premium_ad"],paid:true,enabled:false},
 {key:"cinematic_video",model:"cinematic/provider-model",useCases:["cinematic"],paid:true,enabled:false},
];
export function videoCapabilities(){return VIDEO_MODEL_CATALOG.map(({key,useCases,paid,enabled})=>({key,useCases,paid,enabled}));}
export function chooseVideoModel(useCase:VideoUseCase="fast_social"){
 const match=VIDEO_MODEL_CATALOG.find(x=>x.enabled&&x.useCases.includes(useCase));
 if(!match)throw new Error("Nenhum modelo de vídeo habilitado para este caso de uso.");
 return match;
}

export interface VideoRoutingInput{objective?:string;channel?:string;format?:string;hasImage?:boolean;hasReferences?:boolean;}
export function inferVideoUseCase(input:VideoRoutingInput):VideoUseCase{
 const text=`${input.objective||""} ${input.channel||""} ${input.format||""}`.toLowerCase();
 if(input.hasReferences)return "reference_to_video";
 if(input.hasImage)return "image_to_video";
 if(/cinema|cinematic|filme|storytelling|brand film/.test(text))return "cinematic";
 if(/ads|ad|anúncio|anuncio|performance|conversão|conversao|campanha paga|google/.test(text))return "premium_ad";
 return "fast_social";
}
export function routeVideoModel(input:VideoRoutingInput){
 const requested=inferVideoUseCase(input);
 try{return{requested,useCase:requested,profile:chooseVideoModel(requested),fallback:false};}
 catch{
  const fallback=chooseVideoModel("fast_social");
  return{requested,useCase:"fast_social" as VideoUseCase,profile:fallback,fallback:true};
 }
}
