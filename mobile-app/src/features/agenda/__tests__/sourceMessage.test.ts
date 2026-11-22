import {
  ORIGINAL_GONE_COPY,
  toOriginalMessage,
  type RawMessageRowInput,
} from "../sourceMessage";

const row = (over: Partial<RawMessageRowInput>): RawMessageRowInput => ({
  sender_name: "Ayesha",
  raw_text: "Assignment 2 is due Friday 11:59 PM",
  sent_at: "2026-11-18T09:05:00Z",
  media_type: "none",
  ...over,
});

describe("toOriginalMessage", () => {
  it("shows the sender, the captured text and when it was sent in the profile zone", () => {
    const message = toOriginalMessage(row({}), "Asia/Kolkata");
    expect(message.sender).toBe("Ayesha");
    expect(message.text).toBe("Assignment 2 is due Friday 11:59 PM");
    // 09:05Z is 2:35 PM in Asia/Kolkata (UTC+5:30).
    expect(message.sentLabel).toBe("Wed, Nov 18 · 2:35 PM");
    expect(message.hasMedia).toBe(false);
  });

  it("never renders an empty sender or an empty body", () => {
    const message = toOriginalMessage(
      row({ sender_name: "   ", raw_text: "  ", media_type: "pdf" }),
      "UTC",
    );
    expect(message.sender).toBe("Someone");
    expect(message.text).toBe("Sent a file.");
    expect(message.hasMedia).toBe(true);
  });

  it("keeps a caption on a file message", () => {
    const message = toOriginalMessage(
      row({ raw_text: "Slides for week 8", media_type: "pptx" }),
      "UTC",
    );
    expect(message.text).toBe("Slides for week 8");
    expect(message.hasMedia).toBe(true);
  });

  it("has honest copy for a message that the 30-day purge removed", () => {
    expect(ORIGINAL_GONE_COPY).toContain("30 days");
    expect(ORIGINAL_GONE_COPY).toContain("no longer available");
  });
});
