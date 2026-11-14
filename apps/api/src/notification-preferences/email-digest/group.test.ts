import { describe, expect, it } from "vite-plus/test";
import { groupDigestEntries } from "./group";

const entry = (key: string, title: string) => ({
  id: `${key}-${title}`,
  key,
  heading: `Task ${key}`,
  url: `https://kaneo.example/task/${key}`,
  title,
  message: `${title} on ${key}`,
});

describe("groupDigestEntries", () => {
  it("groups entries by task in order of first appearance", () => {
    const groups = groupDigestEntries([
      entry("b", "first"),
      entry("a", "second"),
      entry("b", "third"),
    ]);
    expect(groups.map((group) => group.heading)).toEqual(["Task b", "Task a"]);
    expect(groups[0]?.items.map((item) => item.title)).toEqual([
      "first",
      "third",
    ]);
  });
});
