import { describe, expect, it } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  mergeNotificationPreferences,
  notificationPreferenceKeyForType,
} from "../notifications";

describe("notificationPreferenceKeyForType", () => {
  it("maps all backend push event types to user-facing preference keys", () => {
    expect(notificationPreferenceKeyForType("game_live")).toBe("gameLive");
    expect(notificationPreferenceKeyForType("pick_resolved")).toBe("pickResult");
    expect(notificationPreferenceKeyForType("pick_result")).toBe("pickResult");
    expect(notificationPreferenceKeyForType("winner_flip")).toBe("predictionShift");
    expect(notificationPreferenceKeyForType("big_game")).toBe("bigGame");
    expect(notificationPreferenceKeyForType("game_spotlight")).toBe("gameSpotlight");
    expect(notificationPreferenceKeyForType("underdog_alert")).toBe("underdog");
    expect(notificationPreferenceKeyForType("streak")).toBe("streak");
  });

  it("treats unknown/general notification types as ungated", () => {
    expect(notificationPreferenceKeyForType(undefined)).toBe(null);
    expect(notificationPreferenceKeyForType("general")).toBe(null);
  });
});

describe("mergeNotificationPreferences", () => {
  it("defaults every notification category to enabled", () => {
    expect(mergeNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("preserves explicit opt-outs while filling missing categories", () => {
    expect(mergeNotificationPreferences({
      pickResult: false,
      predictionShift: false,
    })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      pickResult: false,
      predictionShift: false,
    });
  });
});
