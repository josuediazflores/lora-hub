import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

const COMPONENTS = {
  // Inline code (`foo`) — distinguish from block code via the `inline` flag.
  code: (props: any) => {
    const { inline, className, children, ...rest } = props;
    if (inline) {
      return (
        <code
          className="rounded bg-app-surface px-1 py-0.5 font-mono text-[0.85em] text-app-text"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre: (props: any) => (
    <pre
      className="my-2 overflow-x-auto rounded-md border border-app-border bg-app-bg/70 px-3 py-2 font-mono text-[12px] leading-relaxed"
      {...props}
    />
  ),
  a: (props: any) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-app-accent underline-offset-2 hover:underline"
    />
  ),
  ul: (props: any) => (
    <ul className="my-2 ml-5 list-disc space-y-1" {...props} />
  ),
  ol: (props: any) => (
    <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />
  ),
  p: (props: any) => <p className="mb-2 leading-[1.55] last:mb-0" {...props} />,
  h1: (props: any) => (
    <h1
      className="mt-3 mb-2 text-[17px] font-semibold tracking-tight"
      {...props}
    />
  ),
  h2: (props: any) => (
    <h2 className="mt-3 mb-2 text-[15px] font-semibold" {...props} />
  ),
  h3: (props: any) => (
    <h3 className="mt-3 mb-2 text-[14px] font-semibold" {...props} />
  ),
  blockquote: (props: any) => (
    <blockquote
      className="my-2 border-l-2 border-app-accent/70 pl-3 text-app-text-muted"
      {...props}
    />
  ),
  table: (props: any) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: any) => (
    <th className="border border-app-border bg-app-surface px-2 py-1 text-left" {...props} />
  ),
  td: (props: any) => (
    <td className="border border-app-border px-2 py-1" {...props} />
  ),
  hr: () => <hr className="my-3 border-app-border" />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeHighlight, { detect: true, ignoreMissing: true }],
        rehypeKatex,
      ]}
      components={COMPONENTS}
    >
      {children}
    </ReactMarkdown>
  );
}
