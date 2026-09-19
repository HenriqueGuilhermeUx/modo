export type VideoUseCase="fast_social"|"premium_ad"|"cinematic"|"image_to_video"|"reference_to_video";
export interface VideoModelProfile{key:string;model:string;useCases:VideoUseCase[];paid:boolean;enabled:boolean;}
export const VIDEO_MODEL_CATALOG:VideoModelProfile[]=[
 {key:"seedance_2_5",model:"bytedance/seedance-2.5/text-to-video",useCases:["fast_social","premium_ad"],paid:true,enabled:true},
];
export function chooseVideoModel(useCase:VideoUseCase="fast_social"){
 const match=VIDEO_MODEL_CATALOG.find(x=>x.enabled&&x.useCases.includes(useCase));
 if(!match)throw new Error("Nenhum modelo de vídeo habilitado para este caso de uso.");
 return match;
}
