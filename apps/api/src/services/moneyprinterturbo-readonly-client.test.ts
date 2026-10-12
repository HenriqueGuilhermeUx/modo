import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyPrinterTurboReadOnlyClient } from "./moneyprinterturbo-readonly-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("MoneyPrinterTurbo read-only adapter", () => {
  it("rejects non-HTTPS endpoints and embedded credentials", () => {
    expect(() => new MoneyPrinterTurboReadOnlyClient("http://localhost:8080", "key")).toThrow();
    expect(() => new MoneyPrinterTurboReadOnlyClient("https://user:pass@example.com/", "key")).toThrow();
    expect(() => new MoneyPrinterTurboReadOnlyClient("https://example.com/path", "key")).toThrow();
    expect(() => new MoneyPrinterTurboReadOnlyClient("https://example.com/", "")).toThrow();
  });

  it("fails closed when upstream accepts an invalid key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new MoneyPrinterTurboReadOnlyClient("https://worker.internal/", "secret");
    expect(await client.checkAuthentication()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates both rejection and accepted authorized response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 200, data: { tasks: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new MoneyPrinterTurboReadOnlyClient("https://worker.internal/", "secret");
    expect(await client.checkAuthentication()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["x-api-key"]).toBe("secret");
  });

  it("rejects malformed task IDs before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new MoneyPrinterTurboReadOnlyClient("https://worker.internal/", "secret");
    await expect(client.getJob("../tasks")).rejects.toThrow("Invalid task ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports upstream failed tasks without exposing assets", async () => {
    const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        status: 200, data: { task_id: taskId, state: -1, error: "render failed",
          videos: ["https://worker.internal/tasks/private.mp4"] },
      }),
    }));
    const client = new MoneyPrinterTurboReadOnlyClient("https://worker.internal/", "secret");
    const result = await client.getJob(taskId);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("render failed");
    expect(result.assets).toEqual([]);
  });

  it("never exposes unverified upstream asset URLs", async () => {
    const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        status: 200,
        data: { task_id: taskId, state: 1, videos: ["https://worker.internal/tasks/private.mp4"] },
      }),
    }));
    const client = new MoneyPrinterTurboReadOnlyClient("https://worker.internal/", "secret");
    const result = await client.getJob(taskId);
    expect(result.assets).toEqual([]);
    expect(result.status).toBe("processing");
  });
});
