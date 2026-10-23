import React from 'react';
import { createRoot } from 'react-dom/client';
import { Runtime, type Document as ProtocolDocument, type HostAdapter } from '../protocol/index.js';
import { UIRenderer } from '../ui/renderer/Renderer.js';
import type { CreateReplyView } from './reply-coordinator.js';

/** One React root and one protocol runtime for the life of a mounted reply. */
export function createReactReplyView(styles: string, adapter: HostAdapter = {}): CreateReplyView {
  return (hosts: HTMLElement[], document: ProtocolDocument) => {
    const css = `${styles}\n:host{display:block;min-width:0}.iui-theme{min-height:0}`;
    const targetFor = (host: HTMLElement) => {
      const shadow = host.attachShadow({ mode: 'open' });
      const slot = host.ownerDocument.createElement('div');
      slot.setAttribute('data-iui-slot', '');
      const Sheet = host.ownerDocument.defaultView?.CSSStyleSheet;
      let adopted = false;
      if (Sheet && 'adoptedStyleSheets' in shadow && typeof Sheet.prototype.replaceSync === 'function') {
        try {
          const sheet = new Sheet();
          sheet.replaceSync(css);
          shadow.adoptedStyleSheets = [sheet];
          adopted = true;
        } catch { /* Fall back to a regular style node. */ }
      }
      if (!adopted) {
        const style = host.ownerDocument.createElement('style');
        style.textContent = css;
        shadow.append(style);
      }
      shadow.append(slot);
      return slot;
    };
    let currentHosts = hosts;
    let targets: HTMLElement[] = hosts.map(targetFor);
    const rootMount = hosts[0].ownerDocument.createElement('div');
    rootMount.hidden = true;
    hosts[0].shadowRoot!.append(rootMount);
    const root = createRoot(rootMount);
    const runtime = new Runtime(document, adapter); // Only explicitly supplied host capabilities are available.
    const render = () => root.render(<UIRenderer runtime={runtime} targets={targets} />);
    render();
    return {
      update(next: ProtocolDocument, nextHosts = currentHosts) {
        currentHosts = nextHosts;
        targets = nextHosts.map(host => host.shadowRoot ? host.shadowRoot.querySelector('[data-iui-slot]') as HTMLElement : targetFor(host));
        runtime.update(next); render();
      },
      dispose() { root.unmount(); },
    };
  };
}
