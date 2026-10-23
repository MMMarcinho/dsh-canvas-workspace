/**
 * Canvas-local segmentation over the MIT IUI parser. Source spans, not HTML or
 * tag-matching regexes, decide which content may become live UI. Validation is
 * adapted from upstream reply-coordinator.ts, with failures isolated per root.
 */
import {
  parseDsl,
  parseDslPreview,
  Runtime,
  SafeEvaluator,
  type Declaration,
  type Document,
  type Node,
} from "../../vendor/open-intelligent-ui/protocol/index.js";

export type CanvasReplySegment =
  | { kind: "markdown"; start: number; text: string }
  | { kind: "error"; start: number; text: string; reason: string }
  | {
      kind: "ui";
      start: number;
      text: string;
      index: number;
      complete: boolean;
    };
export type CanvasReply = {
  document: Document;
  segments: CanvasReplySegment[];
};

const mixedRoots = new Set([
  "box",
  "row",
  "col",
  "grid",
  "card",
  "list",
  "flow",
  "table",
  "carousel",
  "Chart",
]);
const builtins = ["Math", "JSON", "GenUI", "Number", "String"];
const unfinished = new Set([
  "unclosed_tag",
  "incomplete_tag",
  "incomplete_expression",
  "incomplete_body",
  "incomplete_attribute",
  "incomplete_directive",
  "incomplete_raw_block",
]);

/** Inspect names without calling a model-provided function or event handler. */
function referencesReady(source: string, available: Set<string>): boolean {
  let ast: unknown;
  try {
    ast = new SafeEvaluator().parse(source);
  } catch {
    return false;
  }
  const visit = (value: any, names: Set<string>): boolean => {
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value))
      return value.every((child) => visit(child, names));
    if (value.type === "Identifier") return names.has(value.name);
    if (value.type === "Literal" || value.type === "TemplateElement")
      return true;
    if (value.type === "MemberExpression")
      return (
        visit(value.object, names) &&
        (!value.computed || visit(value.property, names))
      );
    if (value.type === "Property")
      return (
        (!value.computed || visit(value.key, names)) &&
        visit(value.value, names)
      );
    if (value.type === "ArrowFunctionExpression") {
      const local = new Set(names);
      for (const param of value.params) {
        if (param.type !== "Identifier") return false;
        local.add(param.name);
      }
      return visit(value.body, local);
    }
    return Object.values(value).every((child) => visit(child, names));
  };
  return visit(ast, available);
}

function validateRoot(
  node: Node,
  runtime: Runtime,
  scope: Record<string, unknown>,
): string | undefined {
  const check = (
    source: string,
    env: Record<string, unknown>,
    evaluate = true,
  ) => {
    if (!referencesReady(source, new Set([...Object.keys(env), ...builtins])))
      throw new Error("表达式引用尚未定义的值或包含不支持的语法");
    return evaluate ? runtime.value(source, env) : undefined;
  };
  const visit = (nodes: Node[], env: Record<string, unknown>): void => {
    for (const item of nodes) {
      if (item.kind === "text") continue;
      if (item.kind === "expression") {
        check(item.source, env);
        continue;
      }
      if (item.kind === "if") {
        if (check(item.test, env)) visit(item.children, env);
        continue;
      }
      if (item.kind === "each") {
        const values = check(item.source, env);
        if (!Array.isArray(values)) throw new Error("循环表达式需要数组");
        for (const [index, value] of values.slice(0, 100).entries())
          visit(item.children, {
            ...env,
            [item.item]: value,
            ...(item.index ? { [item.index]: index } : {}),
          });
        continue;
      }
      for (const [name, attribute] of Object.entries(item.attributes))
        if (attribute.kind === "expression")
          check(String(attribute.value), env, !/^on[A-Z]/.test(name));
      visit(item.children, env);
    }
  };
  try {
    visit([node], scope);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * A root ends only at its parser span (or its explicit, mismatched closing tag).
 * Unclosed trailing syntax stays with that root; preceding completed prose/UI is
 * never rolled back. Code fences, inline code and foreign HTML stay opaque.
 */
export function splitCanvasReply(
  source: string,
  messageId: string,
  streaming: boolean,
  recoveryDepth = 0,
): CanvasReply | null {
  if (!source || !/[<{]/.test(source)) return null;
  if (recoveryDepth > 32) throw new Error("IUI recovery budget exceeded");
  const parsed = parseDsl(source, messageId, true);
  const preview = parsed.complete ? parsed : parseDslPreview(source, messageId);
  const budget = parsed.diagnostics.find((item) => /budget$/.test(item.code));
  if (budget)
    return {
      document: { ...parsed, declarations: [], children: [] },
      segments: [
        { kind: "error", start: 0, text: source, reason: budget.message },
      ],
    };
  const hasProse = parsed.children.some(
    (node) => node.kind === "text" && !!node.text.trim(),
  );
  const roots = parsed.children.filter((node) => {
    if (node.kind !== "element") return false;
    if (!hasProse) return true;
    const beforeLine =
      source.slice(0, node.span.start).split("\n").at(-1) ?? "";
    const followsDeclaration = parsed.declarations.some(
      (declaration) =>
        declaration.span.end <= node.span.start &&
        !source.slice(declaration.span.end, node.span.start).trim(),
    );
    return (
      followsDeclaration || (mixedRoots.has(node.name) && !beforeLine.trim())
    );
  });
  const declarations: Declaration[] = [];
  const declarationErrors = new Map<number, string>();
  const names = new Set(builtins);
  const env: Record<string, unknown> = {
    Math: Object.freeze({}),
    JSON: Object.freeze({}),
    GenUI: Object.freeze({}),
  };
  const evaluator = new SafeEvaluator();
  for (const declaration of parsed.declarations) {
    try {
      if (
        names.has(declaration.name) ||
        (declaration.setter &&
          (names.has(declaration.setter) ||
            declaration.setter === declaration.name))
      )
        throw new Error("重复声明或保留名称");
      if (!referencesReady(declaration.expression, names))
        throw new Error("声明引用尚未定义的值或包含不支持的语法");
      env[declaration.name] = evaluator.evaluate(declaration.expression, env);
      names.add(declaration.name);
      if (declaration.setter) {
        names.add(declaration.setter);
        env[declaration.setter] = { $setter: declaration.name };
      }
      declarations.push(declaration);
    } catch (error) {
      declarationErrors.set(
        declaration.span.start,
        `${declaration.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const document: Document = {
    ...parsed,
    declarations,
    children: [],
    diagnostics: [],
  };
  const runtime = new Runtime(document);
  const scope = runtime.scope();
  type Region = { start: number; end: number; segment?: CanvasReplySegment };
  const regions: Region[] = [];
  for (const node of roots) {
    let end = node.span.end < 0 ? source.length : node.span.end;
    // An explicit closing root still supplies a safe display boundary when a
    // nested child was not closed. Its contents remain a source-only error.
    const close = parsed.diagnostics.find(
      (item) =>
        item.code === "mismatched_close" &&
        item.span.start > node.span.start &&
        item.span.end <= end &&
        node.kind === "element" &&
        source.slice(item.span.start, item.span.end) === `</${node.name}>`,
    );
    if (close) end = close.span.end;
    const text = source.slice(node.span.start, end);
    const previewNode = preview.children.find(
      (item) => item.span.start === node.span.start && item.kind === node.kind,
    );
    const complete = !!previewNode && previewNode.span.end >= 0;
    const diagnostic = parsed.diagnostics.find(
      (item) =>
        item.severity === "error" &&
        item.span.start >= node.span.start &&
        item.span.start < end &&
        !(streaming && unfinished.has(item.code)),
    );
    const nestedDeclarationError = parsed.declarations.find(
      (item) =>
        item.span.start > node.span.start &&
        item.span.start < end &&
        declarationErrors.has(item.span.start),
    );
    const candidate = complete ? node : previewNode;
    const reason =
      diagnostic?.message ??
      (nestedDeclarationError
        ? declarationErrors.get(nestedDeclarationError.span.start)
        : undefined) ??
      (!candidate
        ? "IUI 尚未形成可安全显示的内容"
        : !streaming && !complete
          ? "IUI 标签或表达式尚未闭合"
          : validateRoot(candidate, runtime, scope));
    if (reason || !candidate) {
      regions.push({
        start: node.span.start,
        end,
        segment: {
          kind: "error",
          start: node.span.start,
          text,
          reason: reason ?? "IUI 尚未形成可安全显示的内容",
        },
      });
    } else {
      const index = document.children.length;
      document.children.push(candidate);
      regions.push({
        start: node.span.start,
        end,
        segment: { kind: "ui", start: node.span.start, text, index, complete },
      });
    }
    // The parser cannot resume after a mismatched nested close. Reparse only
    // the tail outside the explicit root, with the same declarations available.
    if (close && end < source.length) {
      const prefix = parsed.declarations
        .filter((item) => item.span.end <= node.span.start)
        .map((item) => source.slice(item.span.start, item.span.end))
        .join("\n");
      const separator = prefix ? "\n" : "";
      const tail = splitCanvasReply(
        prefix + separator + source.slice(end),
        messageId,
        streaming,
        recoveryDepth + 1,
      );
      if (tail) {
        const prefixLength = prefix.length + separator.length;
        for (const segment of tail.segments) {
          if (segment.start < prefixLength) continue;
          if (segment.kind === "ui") {
            const index = document.children.length;
            document.children.push(tail.document.children[segment.index]);
            regions.push({
              start: end + segment.start - prefixLength,
              end: end + segment.start - prefixLength + segment.text.length,
              segment: {
                ...segment,
                start: end + segment.start - prefixLength,
                index,
              },
            });
          } else if (segment.kind === "error") {
            regions.push({
              start: end + segment.start - prefixLength,
              end: end + segment.start - prefixLength + segment.text.length,
              segment: {
                ...segment,
                start: end + segment.start - prefixLength,
              },
            });
          }
        }
      }
    }
  }
  for (const declaration of parsed.declarations) {
    if (
      regions.some(
        (region) =>
          declaration.span.start >= region.start &&
          declaration.span.start < region.end,
      )
    )
      continue;
    const reason =
      declarationErrors.get(declaration.span.start) ??
      (!roots.length ? "IUI 尚未形成可安全显示的组件" : undefined);
    regions.push({
      start: declaration.span.start,
      end: declaration.span.end,
      ...(reason
        ? {
            segment: {
              kind: "error" as const,
              start: declaration.span.start,
              text: source.slice(declaration.span.start, declaration.span.end),
              reason,
            },
          }
        : {}),
    });
  }
  for (const diagnostic of parsed.diagnostics) {
    if (
      regions.some(
        (region) =>
          diagnostic.span.start >= region.start &&
          diagnostic.span.start < region.end,
      )
    )
      continue;
    // Only parser-identified protocol syntax is source-only. Foreign HTML and
    // fenced code have no such diagnostic and continue through safe Markdown.
    regions.push({
      start: diagnostic.span.start,
      end: Math.max(diagnostic.span.end, diagnostic.span.start + 1),
      segment: {
        kind: "error",
        start: diagnostic.span.start,
        text: source.slice(diagnostic.span.start, diagnostic.span.end),
        reason: diagnostic.message,
      },
    });
  }
  if (!regions.length) return null;
  regions.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: CanvasReplySegment[] = [];
  let cursor = 0;
  const markdown = (start: number, end: number) => {
    if (end <= start) return;
    const text = source.slice(start, end);
    const previous = segments.at(-1);
    if (previous?.kind === "markdown") previous.text += text;
    else segments.push({ kind: "markdown", start, text });
  };
  for (const region of regions) {
    if (region.start < cursor) continue;
    markdown(cursor, region.start);
    if (region.segment) segments.push(region.segment);
    cursor = region.end;
  }
  markdown(cursor, source.length);
  return { document, segments };
}
