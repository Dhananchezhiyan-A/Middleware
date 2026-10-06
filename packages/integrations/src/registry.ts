import type { DestinationType } from "@middleware/types";
import type { DestinationAdapter } from "./types";

/**
 * Adapter registry — the ONLY place destination implementations are bound to
 * the core pipeline. The pipeline never imports a concrete adapter.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<DestinationType, DestinationAdapter>();

  register(adapter: DestinationAdapter): this {
    this.adapters.set(adapter.type, adapter);
    return this;
  }

  has(type: DestinationType): boolean {
    return this.adapters.has(type);
  }

  /**
   * Throws when no adapter exists for a type — an unknown destination must
   * fail loudly; it must never be treated as delivered.
   */
  get(type: DestinationType): DestinationAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No destination adapter registered for type "${type}".`);
    }
    return adapter;
  }

  types(): DestinationType[] {
    return [...this.adapters.keys()];
  }
}
