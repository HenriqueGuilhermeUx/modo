import { randomUUID } from "node:crypto";
import type { DiagnosticCreateRequest, DiagnosticJob, DiagnosticStage } from "@modo/contracts";
import type { DiagnosticProvider } from "../providers/diagnostic-provider.js";

interface StoredJob extends DiagnosticJob { updatedAt: string; }
const stageProgress: Record<DiagnosticStage, number> = {
  queued: 5, validating: 18, extracting: 42, structuring: 64,
  generating: 84, completed: 100, failed: 100,
};

export class DiagnosticService {
  private readonly jobs = new Map<string, StoredJob>();
  constructor(private readonly provider: DiagnosticProvider) {}

  create(input: DiagnosticCreateRequest): DiagnosticJob {
    const now = new Date().toISOString();
    const id = randomUUID();
    const job: StoredJob = {id, status: "processing", progress: 5, stage: "queued", createdAt: now, updatedAt: now};
    this.jobs.set(id, job);
    void this.process(id, input);
    return this.publicJob(job);
  }

  get(id: string): DiagnosticJob | undefined {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : undefined;
  }

  private async process(id: string, input: DiagnosticCreateRequest) {
    try {
      this.transition(id, "validating"); await this.pause(180);
      this.transition(id, "extracting"); await this.pause(260);
      this.transition(id, "structuring"); await this.pause(220);
      this.transition(id, "generating");
      const result = await this.provider.generate(input);
      const completedAt = new Date().toISOString();
      const current = this.jobs.get(id); if (!current) return;
      this.jobs.set(id, {...current, status: "completed", progress: 100, stage: "completed", result, completedAt, updatedAt: completedAt});
    } catch (error) {
      const current = this.jobs.get(id); if (!current) return;
      const updatedAt = new Date().toISOString();
      this.jobs.set(id, {...current, status: "failed", progress: 100, stage: "failed", error: error instanceof Error ? error.message : "Não foi possível concluir o diagnóstico.", updatedAt});
    }
  }

  private transition(id: string, stage: DiagnosticStage) {
    const current = this.jobs.get(id); if (!current) return;
    const updatedAt = new Date().toISOString();
    this.jobs.set(id, {...current, stage, progress: stageProgress[stage], updatedAt});
  }
  private publicJob(job: StoredJob): DiagnosticJob {
    const {updatedAt: _updatedAt, ...publicJob} = job;
    return publicJob;
  }
  private pause(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
}
