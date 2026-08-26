export type VideoBrollProviderName = "pexels";

export type VideoBrollCredit = {
  provider: "pexels";
  authorName: string;
  authorUrl: string;
  sourceUrl: string;
};

export type VideoBrollAsset = {
  provider: VideoBrollProviderName;
  mimeType: "video/mp4";
  data: Buffer;
  credit: VideoBrollCredit;
};

export interface VideoBrollProvider {
  readonly name: VideoBrollProviderName;
  fetchClip(input: {
    query: string;
    sceneIndex: number;
    revision: number;
  }): Promise<VideoBrollAsset>;
}

type PexelsVideoFile = {
  id?: number;
  quality?: string;
  file_type?: string;
  width?: number;
  height?: number;
  link?: string;
};

type PexelsVideo = {
  id: number;
  url: string;
  duration?: number;
  user?: {
    name?: string;
    url?: string;
  };
  video_files?: PexelsVideoFile[];
};

type PexelsSearchResponse = {
  videos?: PexelsVideo[];
};

type FetchLike = typeof fetch;

function scoreFile(file: PexelsVideoFile) {
  const width = Number(file.width || 0);
  const height = Number(file.height || 0);
  const portraitPenalty = height > width ? 0 : 1_000_000;
  const targetPenalty = Math.abs(width - 720) + Math.abs(height - 1280);
  const oversizedPenalty = width > 1280 || height > 2280 ? 200_000 : 0;
  return portraitPenalty + oversizedPenalty + targetPenalty;
}

async function readWithLimit(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error("O B-roll encontrado excede o limite de tamanho da MODO.");
  }
  if (!response.body) {
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new Error("O B-roll encontrado excede o limite de tamanho da MODO.");
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("O B-roll encontrado excede o limite de tamanho da MODO.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export class PexelsVideoBrollProvider implements VideoBrollProvider {
  readonly name = "pexels" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  async fetchClip(input: { query: string; sceneIndex: number; revision: number }): Promise<VideoBrollAsset> {
    const query = input.query.trim();
    if (!query) throw new Error("A cena precisa de uma busca visual para encontrar B-roll.");

    const url = new URL("https://api.pexels.com/v1/videos/search");
    url.searchParams.set("query", query);
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("locale", "pt-BR");
    url.searchParams.set("per_page", "8");

    const search = await this.fetchImpl(url, {
      headers: { Authorization: this.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!search.ok) {
      throw new Error(`Pexels respondeu ${search.status} ao buscar B-roll.`);
    }

    const payload = await search.json() as PexelsSearchResponse;
    const candidates = (payload.videos || [])
      .map((video) => {
        const file = (video.video_files || [])
          .filter((item) => item.file_type === "video/mp4" && item.link)
          .sort((left, right) => scoreFile(left) - scoreFile(right))[0];
        return file ? { video, file } : null;
      })
      .filter((item): item is { video: PexelsVideo; file: PexelsVideoFile } => Boolean(item));

    if (!candidates.length) throw new Error("Nenhum B-roll vertical compatível foi encontrado para esta cena.");

    const selected = candidates[Math.abs(input.revision + input.sceneIndex - 1) % candidates.length];
    const clipUrl = selected.file.link!;
    const clip = await this.fetchImpl(clipUrl, { signal: AbortSignal.timeout(30_000) });
    if (!clip.ok) throw new Error(`Não foi possível baixar o B-roll selecionado (${clip.status}).`);

    const contentType = (clip.headers.get("content-type") || "video/mp4").split(";", 1)[0].trim();
    if (contentType !== "video/mp4" && contentType !== "application/octet-stream") {
      throw new Error(`Formato de B-roll não suportado: ${contentType || "desconhecido"}.`);
    }

    const data = await readWithLimit(clip, this.maxBytes);
    if (!data.length) throw new Error("O B-roll retornado pelo provider está vazio.");

    return {
      provider: "pexels",
      mimeType: "video/mp4",
      data,
      credit: {
        provider: "pexels",
        authorName: selected.video.user?.name?.trim() || "Criador Pexels",
        authorUrl: selected.video.user?.url || "https://www.pexels.com",
        sourceUrl: selected.video.url || "https://www.pexels.com",
      },
    };
  }
}
