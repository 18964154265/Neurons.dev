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

  it("does not execute raw HTML in completed Markdown", () => {
    const { container } = render(
      <MarkdownMessage
        content={'<script data-testid="unsafe">alert(1)</script>\n\n**safe**'}
      />,
    );

    expect(screen.queryByTestId("unsafe")).not.toBeInTheDocument();
    expect(screen.getByText("safe")).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });

  it("uses lightweight plain text while streaming", () => {
    const { container } = render(
      <MarkdownMessage content={"**partial**"} streaming />,
    );

    const stream = container.querySelector(".markdown-content-streaming");
    expect(stream).toHaveTextContent("**partial**");
    expect(container.querySelector("strong")).not.toBeInTheDocument();
  });
});
