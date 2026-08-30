import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "@/components/chat/markdown-message";

describe("MarkdownMessage", () => {
  it("renders common Markdown and GFM structures", () => {
    const { container } = render(
      <MarkdownMessage
        content={"## Result\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      />,
    );

    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("does not execute raw HTML and shows a streaming cursor", () => {
    const { container } = render(
      <MarkdownMessage
        content={'<script data-testid="unsafe">alert(1)</script>\n\n**safe**'}
        streaming
      />,
    );

    expect(screen.queryByTestId("unsafe")).not.toBeInTheDocument();
    expect(screen.getByText("safe")).toBeInTheDocument();
    expect(container.querySelector(".streaming-cursor")).toBeInTheDocument();
  });
});
