import type { SiteAdapter } from './site-adapter.js';

/** Ordering is deliberate: a more specific adapter may precede a general one. */
export class SiteAdapterRegistry {
  private readonly adapters: SiteAdapter[] = [];
  register(adapter: SiteAdapter): () => void {
    if (this.adapters.some(existing => existing.siteId === adapter.siteId)) throw new Error(`duplicate site adapter: ${adapter.siteId}`);
    this.adapters.push(adapter);
    return () => { const index = this.adapters.indexOf(adapter); if (index >= 0) this.adapters.splice(index, 1); };
  }
  match(url: URL): SiteAdapter | null { return this.adapters.find(adapter => adapter.matches(url)) ?? null; }
  get(siteId: string): SiteAdapter | null { return this.adapters.find(adapter => adapter.siteId === siteId) ?? null; }
}
