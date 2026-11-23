import { starterPromptsFor } from "../starterPrompts";
import { ALL_SCOPE } from "../scope";

describe("starterPromptsFor", () => {
  it("offers three or four all-materials starters", () => {
    const prompts = starterPromptsFor(ALL_SCOPE);
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    expect(prompts.length).toBeLessThanOrEqual(4);
    expect(prompts[0].prompt).toContain("latest");
  });

  it("switches to subject starters", () => {
    const prompts = starterPromptsFor({
      kind: "subject",
      id: "s1",
      name: "Operating Systems",
    });
    expect(prompts.some((prompt) => prompt.prompt.includes("this subject"))).toBe(
      true,
    );
    expect(prompts.some((prompt) => prompt.label === "Quiz me")).toBe(true);
  });

  it("switches to document starters", () => {
    const prompts = starterPromptsFor({
      kind: "document",
      id: "d1",
      name: "OS M2.docx",
    });
    expect(prompts[0].prompt).toContain("this document");
    expect(prompts.length).toBeLessThanOrEqual(4);
  });
});
