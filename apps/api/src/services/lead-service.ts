import { randomUUID } from "node:crypto";
import type { LeadCreateRequest } from "@modo/contracts";

export interface StoredLead extends LeadCreateRequest { id: string; createdAt: string; }

export class LeadService {
  private readonly leads = new Map<string, StoredLead>();

  create(input: LeadCreateRequest): StoredLead {
    const lead = {...input, id: randomUUID(), createdAt: new Date().toISOString()};
    this.leads.set(lead.id, lead);
    return lead;
  }
}
