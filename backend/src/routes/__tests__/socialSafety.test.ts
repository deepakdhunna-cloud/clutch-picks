import { describe, expect, it } from "bun:test";
import { blockedCounterpartIdsFor } from "../social";

describe("blockedCounterpartIdsFor", () => {
  it("hides users blocked by the viewer", () => {
    const hidden = blockedCounterpartIdsFor("viewer", [
      { blockerId: "viewer", blockedId: "blocked-user" },
    ]);

    expect(hidden.has("blocked-user")).toBe(true);
  });

  it("hides users who blocked the viewer", () => {
    const hidden = blockedCounterpartIdsFor("viewer", [
      { blockerId: "other-user", blockedId: "viewer" },
    ]);

    expect(hidden.has("other-user")).toBe(true);
  });

  it("deduplicates counterpart ids across both block directions", () => {
    const hidden = blockedCounterpartIdsFor("viewer", [
      { blockerId: "viewer", blockedId: "other-user" },
      { blockerId: "other-user", blockedId: "viewer" },
    ]);

    expect([...hidden]).toEqual(["other-user"]);
  });
});
