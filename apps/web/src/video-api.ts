import {
  VideoProjectCreateSchema,
  VideoProjectSchema,
  type VideoProject,
  type VideoProjectCreate,
} from "@modo/contracts/video";
import { clearSessionToken, getSessionToken } from "./api";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSessionToken();
    throw new Error(payload.message || "Não foi possível concluir a operação de vídeo.");
  }
  return payload as T;
}

export async function createVideoProject(input: VideoProjectCreate): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>("/api/v1/video-projects", {
    method: "POST",
    body: JSON.stringify(VideoProjectCreateSchema.parse(input)),
  });
  return VideoProjectSchema.parse(payload.project);
}

export async function getLatestVideoProject(contentRequestId: string): Promise<VideoProject | null> {
  const payload = await request<{ project: unknown | null }>(
    `/api/v1/video-projects/by-content/${encodeURIComponent(contentRequestId)}`,
  );
  return payload.project ? VideoProjectSchema.parse(payload.project) : null;
}

export async function getVideoProject(id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(`/api/v1/video-projects/${encodeURIComponent(id)}`);
  return VideoProjectSchema.parse(payload.project);
}

export async function regenerateVideoScene(id: string, sceneIndex: number): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/regenerate`,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function approveVideoScene(id: string, sceneIndex: number): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/scenes/${sceneIndex}/approve`,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function approveVideoProject(id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(
    `/api/v1/video-projects/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
  );
  return VideoProjectSchema.parse(payload.project);
}

export async function retryVideoProject(id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(`/api/v1/video-projects/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
  return VideoProjectSchema.parse(payload.project);
}

export async function cancelVideoProject(id: string): Promise<VideoProject> {
  const payload = await request<{ project: unknown }>(`/api/v1/video-projects/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  return VideoProjectSchema.parse(payload.project);
}
