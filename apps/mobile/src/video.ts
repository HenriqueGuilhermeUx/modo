import {
  VideoProjectCreateSchema,
  VideoProjectSchema,
  VideoSceneTakeListSchema,
  VideoSceneUpdateSchema,
  type VideoProject,
  type VideoProjectCreate,
  type VideoSceneTake,
  type VideoSceneUpdate,
} from "@modo/contracts/video";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://modo-api-3m10.onrender.com").replace(/\/$/, "");

export class MobileVideoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MobileVideoError";
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    throw new MobileVideoError(
      String(source.message || "Não foi possível concluir a operação de vídeo."),
      response.status,
      typeof source.code === "string" ? source.code : undefined,
    );
  }
  return payload as T;
}

export async function createVideoProject(token: string, input: VideoProjectCreate): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    "/api/v1/video-projects",
    token,
    { method: "POST", body: JSON.stringify(VideoProjectCreateSchema.parse(input)) },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function getLatestVideoProject(token: string, contentRequestId: string): Promise<VideoProject | null> {
  const payload = await request<{ project: unknown | null }>(
    `/api/v1/video-projects/by-content/${encodeURIComponent(contentRequestId)}`,
    token,
  );
  return payload.project ? VideoProjectSchema.parse(payload.project) : null;
}

export async function getVideoProject(token: string, id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}`,
    token,
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function updateVideoScene(
  token: string,
  id: string,
  sceneIndex: number,
  input: VideoSceneUpdate,
): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}`,
    token,
    { method: "PATCH", body: JSON.stringify(VideoSceneUpdateSchema.parse(input)) },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function regenerateVideoScene(token: string, id: string, sceneIndex: number): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/regenerate`,
    token,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function approveVideoScene(token: string, id: string, sceneIndex: number): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/approve`,
    token,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function approveVideoProject(token: string, id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/approve`,
    token,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function retryVideoProject(token: string, id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/retry`,
    token,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function getVideoSceneTakes(token: string, id: string, sceneIndex: number): Promise<VideoSceneTake[]> {
  const payload = await request<unknown>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/takes`,
    token,
  );
  return VideoSceneTakeListSchema.parse(payload).takes;
}

export async function selectVideoSceneTake(
  token: string,
  id: string,
  sceneIndex: number,
  takeToken: string,
): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/takes/${encodeURIComponent(takeToken)}/select`,
    token,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}
