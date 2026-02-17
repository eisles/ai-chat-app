import { beforeEach, describe, expect, it, vi } from "vitest";

const generateStepDraftsFromMetadata = vi.fn();
const listQuestionSets = vi.fn();
const createDraftSet = vi.fn();
const publishSet = vi.fn();

vi.mock("@/lib/recommend-assistant-config/candidate-generator", () => ({
  generateStepDraftsFromMetadata,
}));

vi.mock("@/lib/recommend-assistant-config/repository", () => ({
  listQuestionSets,
  createDraftSet,
  publishSet,
}));

const { POST: postGenerate } = await import(
  "@/app/api/recommend-assistant-settings/generate/route"
);
const { GET: getSets, POST: postSets } = await import(
  "@/app/api/recommend-assistant-settings/sets/route"
);
const { POST: postPublish } = await import(
  "@/app/api/recommend-assistant-settings/publish/route"
);

describe("recommend-assistant-settings APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generate returns steps", async () => {
    generateStepDraftsFromMetadata.mockResolvedValue([
      {
        key: "purpose",
        question: "用途を教えてください",
        quickReplies: ["自宅用"],
        optional: false,
        enabled: true,
        order: 1,
      },
    ]);

    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/generate",
      { method: "POST" }
    );

    const res = await postGenerate(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.steps).toHaveLength(1);
  });

  it("sets GET returns list", async () => {
    listQuestionSets.mockResolvedValue([
      {
        id: "set-1",
        name: "draft",
        version: 1,
        status: "draft",
        steps: [],
        meta: {},
        createdAt: "2026-02-17T00:00:00.000Z",
        updatedAt: "2026-02-17T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/sets",
      { method: "GET" }
    );
    const res = await getSets(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sets).toHaveLength(1);
  });

  it("sets POST creates draft", async () => {
    createDraftSet.mockResolvedValue({
      id: "set-2",
      name: "草案",
      version: 2,
      status: "draft",
      steps: [],
      meta: {},
      createdAt: "2026-02-17T00:00:00.000Z",
      updatedAt: "2026-02-17T00:00:00.000Z",
      publishedAt: null,
    });

    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/sets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "草案",
          steps: [
            {
              key: "purpose",
              question: "用途を教えてください",
              quickReplies: ["自宅用"],
              optional: false,
              enabled: true,
              order: 1,
            },
          ],
        }),
      }
    );

    const res = await postSets(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.set.id).toBe("set-2");
  });

  it("sets POST rejects duplicated step keys", async () => {
    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/sets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "重複キー",
          steps: [
            {
              key: "purpose",
              question: "用途",
              quickReplies: ["自宅用"],
              optional: false,
              enabled: true,
              order: 1,
            },
            {
              key: "purpose",
              question: "用途2",
              quickReplies: ["贈り物"],
              optional: false,
              enabled: true,
              order: 2,
            },
          ],
        }),
      }
    );

    const res = await postSets(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(createDraftSet).not.toHaveBeenCalled();
  });

  it("sets POST returns json error when repository throws", async () => {
    createDraftSet.mockRejectedValue(new Error("db failed"));

    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/sets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "草案",
          steps: [
            {
              key: "purpose",
              question: "用途を教えてください",
              quickReplies: ["自宅用"],
              optional: false,
              enabled: true,
              order: 1,
            },
          ],
        }),
      }
    );

    const res = await postSets(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toContain("db failed");
  });

  it("publish POST updates status", async () => {
    publishSet.mockResolvedValue();

    const req = new Request(
      "http://localhost/api/recommend-assistant-settings/publish",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "set-2" }),
      }
    );

    const res = await postPublish(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(publishSet).toHaveBeenCalledWith("set-2");
  });
});
