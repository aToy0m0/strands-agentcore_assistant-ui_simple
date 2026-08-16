"use client";

import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { remarkHtmlLineBreak } from "@/lib/remark-html-line-break";

export function MarkdownText() {
  return <MarkdownTextPrimitive className="aui-md" remarkPlugins={[remarkGfm, remarkHtmlLineBreak]} />;
}
