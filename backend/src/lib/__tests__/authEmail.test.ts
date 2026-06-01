import { describe, expect, test } from "bun:test";
import { buildOtpEmailContent } from "../authEmail";

describe("auth email content", () => {
  test("puts the verification code in obvious plain-text and HTML copy", () => {
    const content = buildOtpEmailContent("123456");

    expect(content.text.split("\n")[0]).toBe(
      "123456 is your Clutch Picks verification code.",
    );
    expect(content.text).toContain("This code expires in 5 minutes.");
    expect(content.html).toContain("123456 is your Clutch Picks verification code.");
    expect(content.html).toContain(">123456<");
  });
});
