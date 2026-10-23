/** A site owns DOM discovery and text recovery. The shared renderer never knows its selectors. */
export type StreamState = 'complete' | 'streaming' | 'unknown';

export type SiteMessage = {
  /** The site's message container; kept only while it is attached to this document. */
  element: Element;
  /** The exact assistant body to hide while the local preview is visible. */
  body: Element;
  /** Decoded protocol source, including meaningful rich-text line breaks. */
  text: string;
  /** Clone a source interval as inert, formatted site content. Required for mixed replies. */
  cloneTextRange: (start: number, end: number) => DocumentFragment;
  /** Apply site typography to the inert projection without changing selectors. */
  decorateProjection?: (projection: HTMLElement) => void;
  /** Stable within one observed DOM message; adapters must state stronger guarantees explicitly. */
  identity: string;
  conversationId: string;
  stream: StreamState;
};

export interface SiteAdapter {
  readonly siteId: string;
  matches(url: URL): boolean;
  findMessages(document: Document): Iterable<Element>;
  readMessage(element: Element, url: URL): SiteMessage | null;
}
