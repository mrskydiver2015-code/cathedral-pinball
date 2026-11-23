import type { WebGPURenderer } from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createEventBus } from './shared/events.ts';
import {
  COORDINATE_SYSTEM,
  TABLE_SPEC,
  blenderToThree,
  playfieldLocalToWorld,
} from './shared/tableSpec.ts';
import type { RendererBackendKind } from './shared/types.ts';

/**
 * Type-only contract verification ensuring 2026 Three.js WebGPU and Rapier3D types
 * compile cleanly against frozen shared contracts prior to Phase 2 /swarm execution.
 */
export interface Phase1ContractSmoke {
  readonly rendererType: WebGPURenderer | null;
  readonly rapierModule: typeof RAPIER | null;
  readonly preferredBackend: RendererBackendKind;
}

const bus = createEventBus();
const leftFlipperWorld = playfieldLocalToWorld(TABLE_SPEC.flippers.left.pivotLocal);
const blenderOriginMapped = blenderToThree({ x: 0, y: 0, z: 0 });

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.style.display = 'grid';
  app.style.placeItems = 'center';
  app.style.padding = '24px';
  app.innerHTML = `
    <main style="max-width: 640px; line-height: 1.5;">
      <h1 style="margin: 0 0 8px; font-size: 1.25rem;">Cathedral Pinball — Phase 1 Contracts Frozen</h1>
      <p style="margin: 0; opacity: 0.8;">
        Tilt ${COORDINATE_SYSTEM.tiltDeg}° (${COORDINATE_SYSTEM.blenderUpAxis} → ${COORDINATE_SYSTEM.threeRapierUpAxis}),
        playfield ${TABLE_SPEC.cabinet.innerWidth}m × ${TABLE_SPEC.cabinet.innerLength}m,
        left flipper world Y=${leftFlipperWorld.y.toFixed(4)}m,
        origin=(${blenderOriginMapped.x}, ${blenderOriginMapped.y}, ${blenderOriginMapped.z}),
        event keys tracked=${Object.keys(bus.getEventCounts()).length}.
      </p>
    </main>
  `;
}
