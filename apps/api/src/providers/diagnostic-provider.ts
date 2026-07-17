import type { DiagnosticCreateRequest, DiagnosticResult } from "@modo/contracts";

export interface DiagnosticProvider {
  generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult>;
}
