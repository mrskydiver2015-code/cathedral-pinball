import { TABLE_SPEC } from '../shared/tableSpec.ts';
import type {
  AssetManifest,
  AssetManifestEntry,
  MaterialPerformanceTier,
} from '../shared/types.ts';

/** Public URL path to the exported +Y-Up glTF binary table assembly. */
export const TABLE_GLB_PATH = '/assets/pinball_table.glb';

/**
 * Nodes permitted to use physical refractive transmission (`MeshPhysicalNodeMaterial`)
 * per the Intel Arc integrated GPU performance guardrail in AGENTS.md.
 */
export const SELECTIVE_TRANSMISSION_NODES = [
  TABLE_SPEC.anchorNodes.stainedGlassRamp,
  TABLE_SPEC.anchorNodes.roseWindowInsert,
  `${TABLE_SPEC.anchorNodes.bumperTop}_Cap`,
  `${TABLE_SPEC.anchorNodes.bumperLeft}_Cap`,
  `${TABLE_SPEC.anchorNodes.bumperRight}_Cap`,
] as const;

/** Nodes using opaque PBR + emissive accents without screen-space transmission overhead. */
export const EMISSIVE_ACCENT_NODES = [
  'Backglass_StainedGlass',
  'DropTarget_1',
  'DropTarget_2',
  'DropTarget_3',
  'Slingshot_Left',
  'Slingshot_Right',
  'Multiball_Lock_Pocket',
] as const;

/** Complete list of canonical named nodes expected in `pinball_table.glb`. */
export const CANONICAL_EXPECTED_NODES = [
  TABLE_SPEC.anchorNodes.root,
  'Cabinet_Wall_Left',
  'Cabinet_Wall_Right',
  'Cabinet_Wall_Front',
  'Cabinet_Wall_Rear',
  'Cabinet_Floor',
  'Cabinet_Rail_Left',
  'Cabinet_Rail_Right',
  'Cabinet_Lockdown_Bar',
  'Cabinet_Backbox_Arch',
  'Backglass_StainedGlass',
  TABLE_SPEC.anchorNodes.playfieldDeck,
  TABLE_SPEC.anchorNodes.roseWindowInsert,
  TABLE_SPEC.anchorNodes.plungerDivider,
  'Plunger_Housing',
  'Plunger_Spring',
  'Plunger_Rod',
  'Upper_Orbit_Arch',
  'Rollover_Divider_1',
  'Rollover_Divider_2',
  'Rollover_Divider_3',
  'Rollover_Divider_4',
  TABLE_SPEC.anchorNodes.bumperTop,
  `${TABLE_SPEC.anchorNodes.bumperTop}_Cap`,
  TABLE_SPEC.anchorNodes.bumperLeft,
  `${TABLE_SPEC.anchorNodes.bumperLeft}_Cap`,
  TABLE_SPEC.anchorNodes.bumperRight,
  `${TABLE_SPEC.anchorNodes.bumperRight}_Cap`,
  'Slingshot_Left',
  'Slingshot_Right',
  'Apron_Guide_Left',
  'Apron_Guide_Right',
  'Drain_Guide_Left',
  'Drain_Guide_Right',
  'DropTarget_1',
  'DropTarget_2',
  'DropTarget_3',
  TABLE_SPEC.anchorNodes.stainedGlassRamp,
  'Multiball_Lock_Pocket',
  TABLE_SPEC.anchorNodes.flipperPivotLeft,
  'Flipper_Blade_Left',
  TABLE_SPEC.anchorNodes.flipperPivotRight,
  'Flipper_Blade_Right',
] as const;

/** Helper mapping node name to its enforced rendering material tier. */
export function getNodeMaterialPerformanceTier(nodeName: string): MaterialPerformanceTier {
  if ((SELECTIVE_TRANSMISSION_NODES as readonly string[]).includes(nodeName)) {
    return 'selective-transmission';
  }
  if ((EMISSIVE_ACCENT_NODES as readonly string[]).includes(nodeName)) {
    return 'emissive';
  }
  return 'opaque';
}

const PINBALL_TABLE_GLB_ENTRY: AssetManifestEntry = {
  id: 'cathedral-pinball-table',
  path: TABLE_GLB_PATH,
  kind: 'glb',
  role: 'Space-cadet cathedral stained-glass 6.5-degree pinball table assembly',
  materialTier: 'selective-transmission',
  expectedNodes: CANONICAL_EXPECTED_NODES,
};

/** Frozen Track A asset manifest describing the table GLB and expected scene graph nodes. */
export const ASSET_MANIFEST: AssetManifest = {
  version: '1.0.0',
  entries: [PINBALL_TABLE_GLB_ENTRY],
};
