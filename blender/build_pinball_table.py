"""Reproducible Blender 5.2.3 LTS build script for the Cathedral Pinball table.

Constructs the 6.5-degree tilted space-cadet cathedral stained-glass pinball table
under ``Pinball_Table_Root`` strictly matching ``src/shared/tableSpec.ts`` (1 unit = 1 m),
exports ``public/assets/pinball_table.glb`` (+Y Up, ``export_apply=False``), and optionally
renders multi-angle verification previews into ``../Pinball dok`` when invoked with
``-- --render-qa``.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Iterable, Sequence

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector


# ---------------------------------------------------------------------------
# Canonical dimensions matching src/shared/tableSpec.ts (1 unit = 1 meter)
# Blender Z-up: +X right, +Y rear/top of table, -Y front/player, +Z up
# ---------------------------------------------------------------------------

TILT_DEG = 6.5
TILT_RAD = math.radians(TILT_DEG)

INNER_WIDTH = 0.515
INNER_LENGTH = 1.070
PLAYFIELD_THICKNESS = 0.018
SIDE_WALL_THICKNESS = 0.020
END_WALL_THICKNESS = 0.022
OUTER_WIDTH = INNER_WIDTH + 2.0 * SIDE_WALL_THICKNESS  # 0.555 m
OUTER_LENGTH = INNER_LENGTH + 2.0 * END_WALL_THICKNESS  # 1.114 m
WALL_BOTTOM_Z = -0.100
WALL_TOP_Z = 0.110
WALL_HEIGHT = WALL_TOP_Z - WALL_BOTTOM_Z  # 0.210 m
FLOOR_THICKNESS = 0.016

# Lift root so the front-bottom outer cabinet edge rests flush on world Z = 0.0
ROOT_LIFT_Z = -(
    (-OUTER_LENGTH * 0.5) * math.sin(TILT_RAD) + WALL_BOTTOM_Z * math.cos(TILT_RAD)
)  # +0.16241138 m

PLUNGER_LANE_WIDTH = 0.036
DIVIDER_THICKNESS = 0.008
DIVIDER_LENGTH = 0.800
DIVIDER_HEIGHT = 0.042
DIVIDER_X = INNER_WIDTH * 0.5 - PLUNGER_LANE_WIDTH - DIVIDER_THICKNESS * 0.5  # +0.2175 m
PLUNGER_CENTER_X = DIVIDER_X + DIVIDER_THICKNESS * 0.5 + PLUNGER_LANE_WIDTH * 0.5  # +0.2395 m
DIVIDER_Y_MIN = -INNER_LENGTH * 0.5  # -0.535 m (front inner wall)
DIVIDER_Y_MAX = DIVIDER_Y_MIN + DIVIDER_LENGTH  # +0.265 m

MAIN_ACTIVE_X_MIN = -INNER_WIDTH * 0.5  # -0.2575 m
MAIN_ACTIVE_X_MAX = DIVIDER_X - DIVIDER_THICKNESS * 0.5  # +0.2135 m
MAIN_CENTER_X = (MAIN_ACTIVE_X_MIN + MAIN_ACTIVE_X_MAX) * 0.5  # -0.022 m

FLIPPER_PIVOT_Y = -0.345  # Three.js local Z = +0.345 m
FLIPPER_HALF_SPAN_X = 0.092
FLIPPER_LEFT_X = MAIN_CENTER_X - FLIPPER_HALF_SPAN_X  # -0.114 m
FLIPPER_RIGHT_X = MAIN_CENTER_X + FLIPPER_HALF_SPAN_X  # +0.070 m
FLIPPER_LENGTH = 0.076
FLIPPER_HEIGHT = 0.024
FLIPPER_REST_DEG = 28.0

REPO_ROOT = Path(r"C:\AI-ProjectsAG\Pinball")
GLB_OUTPUT_PATH = REPO_ROOT / "public" / "assets" / "pinball_table.glb"
DOK_OUTPUT_DIR = Path(r"C:\AI-ProjectsAG\Pinball dok")

COLLECTION_NAME = "Pinball_Table"
PREVIEW_COLLECTION_NAME = "Studio_Preview"


# ---------------------------------------------------------------------------
# Scene Cleanup & Collection Utilities
# ---------------------------------------------------------------------------

def clear_existing_table() -> None:
    """Remove prior Pinball_Table / Pinball_Blockout / preview objects and unused data."""
    target_names = {
        COLLECTION_NAME,
        PREVIEW_COLLECTION_NAME,
        "Pinball_Blockout",
    }
    objs_to_remove: set[bpy.types.Object] = set()

    for col_name in list(target_names):
        col = bpy.data.collections.get(col_name)
        if col is not None:
            objs_to_remove.update(col.all_objects)

    for obj in list(bpy.data.objects):
        if (
            obj.name == "Pinball_Table_Root"
            or obj.name.startswith("Pinball_")
            or obj.name.startswith("Cabinet_")
            or obj.name.startswith("Backglass_")
            or obj.name.startswith("Playfield_")
            or obj.name.startswith("RoseWindow_")
            or obj.name.startswith("Plunger_")
            or obj.name.startswith("Upper_Orbit_")
            or obj.name.startswith("Rollover_")
            or obj.name.startswith("Bumper_")
            or obj.name.startswith("Slingshot_")
            or obj.name.startswith("Apron_")
            or obj.name.startswith("Drain_")
            or obj.name.startswith("DropTarget_")
            or obj.name.startswith("Ramp_")
            or obj.name.startswith("Multiball_")
            or obj.name.startswith("Flipper_")
            or obj.name.startswith("Studio_")
        ):
            objs_to_remove.add(obj)

    # Also clear default startup Cube/Light/Camera so exported scene is spotless
    for default_name in ("Cube", "Light", "Camera"):
        default_obj = bpy.data.objects.get(default_name)
        if default_obj is not None:
            objs_to_remove.add(default_obj)

    for obj in objs_to_remove:
        bpy.data.objects.remove(obj, do_unlink=True)

    for col_name in list(target_names):
        col = bpy.data.collections.get(col_name)
        if col is not None:
            bpy.data.collections.remove(col)

    for block_store in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
    ):
        for block in list(block_store):
            if block.users == 0:
                block_store.remove(block)


def get_or_create_collection(name: str) -> bpy.types.Collection:
    """Return an existing or newly linked scene collection."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def link_object(
    obj: bpy.types.Object,
    collection: bpy.types.Collection,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    """Link object into target collection and assign optional parent keeping identity scale."""
    for existing_col in list(obj.users_collection):
        existing_col.objects.unlink(obj)
    collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    obj.scale = (1.0, 1.0, 1.0)
    return obj


# ---------------------------------------------------------------------------
# Material Factory (Blender 5.2 Principled BSDF)
# ---------------------------------------------------------------------------

def make_material(
    name: str,
    base_color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.4,
    ior: float = 1.45,
    transmission: float = 0.0,
    emission_color: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0),
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a clean Principled BSDF material compatible with Blender 5.2 + glTF 2.0."""
    existing = bpy.data.materials.get(name)
    if existing is not None:
        bpy.data.materials.remove(existing)

    mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None:
        mat.use_nodes = True

    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")

    def set_input(socket_name: str, value: object) -> None:
        sock = bsdf.inputs.get(socket_name)
        if sock is not None:
            sock.default_value = value

    set_input("Base Color", base_color)
    set_input("Metallic", metallic)
    set_input("Roughness", roughness)
    set_input("IOR", ior)
    set_input("Transmission Weight", transmission)
    set_input("Emission Color", emission_color)
    set_input("Emission Strength", emission_strength)
    return mat


def create_material_palette() -> dict[str, bpy.types.Material]:
    """Create the space-cadet cathedral stained-glass material palette."""
    return {
        "cabinet_navy": make_material(
            "Mat_Cabinet_Navy",
            (0.025, 0.038, 0.095, 1.0),
            metallic=0.22,
            roughness=0.30,
        ),
        "cabinet_slate": make_material(
            "Mat_Cabinet_Slate",
            (0.045, 0.058, 0.115, 1.0),
            metallic=0.35,
            roughness=0.38,
        ),
        "trim_brass": make_material(
            "Mat_Trim_Brass",
            (0.84, 0.63, 0.24, 1.0),
            metallic=0.92,
            roughness=0.24,
        ),
        "trim_chrome": make_material(
            "Mat_Trim_Chrome",
            (0.85, 0.88, 0.94, 1.0),
            metallic=0.96,
            roughness=0.15,
        ),
        "lead_came": make_material(
            "Mat_Lead_Came",
            (0.055, 0.060, 0.075, 1.0),
            metallic=0.78,
            roughness=0.40,
        ),
        "playfield_deck": make_material(
            "Mat_Playfield_Deck",
            (0.012, 0.018, 0.052, 1.0),
            metallic=0.06,
            roughness=0.28,
        ),
        "glass_rose": make_material(
            "Mat_Glass_RoseWindow",
            (0.16, 0.48, 0.96, 1.0),
            metallic=0.0,
            roughness=0.10,
            ior=1.48,
            transmission=0.75,
            emission_color=(0.14, 0.40, 0.92, 1.0),
            emission_strength=0.65,
        ),
        "glass_ramp": make_material(
            "Mat_Glass_Ramp",
            (0.18, 0.68, 0.96, 1.0),
            metallic=0.0,
            roughness=0.09,
            ior=1.48,
            transmission=0.72,
            emission_color=(0.12, 0.45, 0.88, 1.0),
            emission_strength=0.45,
        ),
        "bumper_top_cap": make_material(
            "Mat_Bumper_Cap_Top",
            (0.96, 0.56, 0.06, 1.0),
            metallic=0.0,
            roughness=0.12,
            ior=1.48,
            transmission=0.74,
            emission_color=(0.96, 0.56, 0.06, 1.0),
            emission_strength=0.75,
        ),
        "bumper_left_cap": make_material(
            "Mat_Bumper_Cap_Left",
            (0.14, 0.68, 0.96, 1.0),
            metallic=0.0,
            roughness=0.12,
            ior=1.48,
            transmission=0.74,
            emission_color=(0.14, 0.68, 0.96, 1.0),
            emission_strength=0.75,
        ),
        "bumper_right_cap": make_material(
            "Mat_Bumper_Cap_Right",
            (0.84, 0.34, 0.96, 1.0),
            metallic=0.0,
            roughness=0.12,
            ior=1.48,
            transmission=0.74,
            emission_color=(0.84, 0.34, 0.96, 1.0),
            emission_strength=0.75,
        ),
        "backglass_emissive": make_material(
            "Mat_Backglass_StainedGlass",
            (0.08, 0.24, 0.72, 1.0),
            metallic=0.0,
            roughness=0.18,
            emission_color=(0.14, 0.36, 0.88, 1.0),
            emission_strength=0.70,
        ),
        "backglass_gold_pane": make_material(
            "Mat_Backglass_GoldPane",
            (0.92, 0.56, 0.10, 1.0),
            metallic=0.0,
            roughness=0.18,
            emission_color=(0.95, 0.58, 0.10, 1.0),
            emission_strength=0.78,
        ),
        "backglass_ruby_pane": make_material(
            "Mat_Backglass_RubyPane",
            (0.76, 0.10, 0.28, 1.0),
            metallic=0.0,
            roughness=0.18,
            emission_color=(0.84, 0.12, 0.30, 1.0),
            emission_strength=0.72,
        ),
        "rubber": make_material(
            "Mat_Rubber_Band",
            (0.14, 0.04, 0.07, 1.0),
            metallic=0.0,
            roughness=0.78,
        ),
        "flipper_body": make_material(
            "Mat_Flipper_Body",
            (0.92, 0.89, 0.82, 1.0),
            metallic=0.05,
            roughness=0.22,
        ),
        "drop_target": make_material(
            "Mat_DropTarget_Crystal",
            (0.92, 0.16, 0.32, 1.0),
            metallic=0.05,
            roughness=0.18,
            emission_color=(0.92, 0.12, 0.28, 1.0),
            emission_strength=0.75,
        ),
        "slingshot_top": make_material(
            "Mat_Slingshot_Plaque",
            (0.14, 0.42, 0.85, 1.0),
            metallic=0.10,
            roughness=0.22,
            emission_color=(0.18, 0.55, 0.95, 1.0),
            emission_strength=0.60,
        ),
        "lock_beacon": make_material(
            "Mat_Lock_Beacon",
            (0.96, 0.28, 0.18, 1.0),
            metallic=0.0,
            roughness=0.15,
            emission_color=(0.98, 0.38, 0.12, 1.0),
            emission_strength=1.20,
        ),
    }


# ---------------------------------------------------------------------------
# Mesh / BMesh Geometry Builders
# ---------------------------------------------------------------------------

def finalize_bmesh_object(
    name: str,
    bm: bmesh.types.BMesh,
    materials: Sequence[bpy.types.Material],
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    *,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    smooth_all: bool = False,
    planar_uv_bounds: tuple[float, float, float, float] | None = None,
) -> bpy.types.Object:
    """Convert a BMesh into a Blender object with clean normals, UVs, and materials."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv_layer = bm.loops.layers.uv.verify()

    if planar_uv_bounds is not None:
        u_min, u_max, v_min, v_max = planar_uv_bounds
        du = max(u_max - u_min, 1e-6)
        dv = max(v_max - v_min, 1e-6)
        for face in bm.faces:
            for loop in face.loops:
                co = loop.vert.co
                loop[uv_layer].uv = ((co.x - u_min) / du, (co.y - v_min) / dv)
    else:
        # Ensure every loop has valid finite UVs using box projection fallback
        for face in bm.faces:
            n = face.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop in face.loops:
                co = loop.vert.co
                if loop[uv_layer].uv.length_squared == 0.0:
                    if az >= ax and az >= ay:
                        loop[uv_layer].uv = (co.x + 0.5, co.y + 0.5)
                    elif ax >= ay and ax >= az:
                        loop[uv_layer].uv = (co.y + 0.5, co.z + 0.5)
                    else:
                        loop[uv_layer].uv = (co.x + 0.5, co.z + 0.5)

    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    bm.to_mesh(mesh)
    bm.free()

    for mat in materials:
        mesh.materials.append(mat)

    if smooth_all and len(mesh.polygons) > 0:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = rotation_euler
    return link_object(obj, collection, parent)


def add_box(
    bm: bmesh.types.BMesh,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z0: float,
    z1: float,
    mat_index: int = 0,
    bevel_width: float = 0.0,
    bevel_segments: int = 2,
) -> list[bmesh.types.BMFace]:
    """Append an axis-aligned box [x0,x1] x [y0,y1] x [z0,z1] with optional bevel."""
    cx = 0.5 * (x0 + x1)
    cy = 0.5 * (y0 + y1)
    cz = 0.5 * (z0 + z1)
    sx = abs(x1 - x0)
    sy = abs(y1 - y0)
    sz = abs(z1 - z0)
    mat_xf = Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat_xf)
    verts = ret["verts"]
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = mat_index
    if bevel_width > 0.0:
        edges = list({e for v in verts for e in v.link_edges})
        bev = bmesh.ops.bevel(
            bm,
            geom=edges,
            offset=bevel_width,
            segments=bevel_segments,
            affect="EDGES",
            clamp_overlap=True,
        )
        for f in bev.get("faces", []):
            f.material_index = mat_index
        faces = list({f for f in bm.faces if f.is_valid})
    return faces


def add_extruded_polygon(
    bm: bmesh.types.BMesh,
    pts_xy: Sequence[tuple[float, float]],
    z0: float,
    z1: float,
    mat_index: int = 0,
    smooth_sides: bool = False,
) -> list[bmesh.types.BMFace]:
    """Extrude a 2D counter-clockwise polygon cleanly from z0 to z1."""
    n = len(pts_xy)
    bot_verts = [bm.verts.new((x, y, z0)) for x, y in pts_xy]
    top_verts = [bm.verts.new((x, y, z1)) for x, y in pts_xy]
    faces: list[bmesh.types.BMFace] = []
    f_bot = bm.faces.new(list(reversed(bot_verts)))
    f_bot.material_index = mat_index
    faces.append(f_bot)
    f_top = bm.faces.new(top_verts)
    f_top.material_index = mat_index
    faces.append(f_top)
    for i in range(n):
        j = (i + 1) % n
        f_side = bm.faces.new([bot_verts[i], bot_verts[j], top_verts[j], top_verts[i]])
        f_side.material_index = mat_index
        f_side.smooth = smooth_sides
        faces.append(f_side)
    return faces


def add_cylinder_z(
    bm: bmesh.types.BMesh,
    cx: float,
    cy: float,
    z0: float,
    z1: float,
    r_bottom: float,
    r_top: float,
    segments: int = 24,
    mat_index: int = 0,
    smooth: bool = True,
) -> list[bmesh.types.BMFace]:
    """Add a vertical cylinder/frustum along +Z with smooth side walls."""
    ring_bot: list[bmesh.types.BMVert] = []
    ring_top: list[bmesh.types.BMVert] = []
    for i in range(segments):
        ang = 2.0 * math.pi * i / segments
        ca, sa = math.cos(ang), math.sin(ang)
        ring_bot.append(bm.verts.new((cx + r_bottom * ca, cy + r_bottom * sa, z0)))
        ring_top.append(bm.verts.new((cx + r_top * ca, cy + r_top * sa, z1)))
    faces: list[bmesh.types.BMFace] = []
    f_bot = bm.faces.new(list(reversed(ring_bot)))
    f_bot.material_index = mat_index
    faces.append(f_bot)
    f_top = bm.faces.new(ring_top)
    f_top.material_index = mat_index
    faces.append(f_top)
    for i in range(segments):
        j = (i + 1) % segments
        f_s = bm.faces.new([ring_bot[i], ring_bot[j], ring_top[j], ring_top[i]])
        f_s.material_index = mat_index
        f_s.smooth = smooth
        faces.append(f_s)
    return faces


def add_revolved_profile_z(
    bm: bmesh.types.BMesh,
    cx: float,
    cy: float,
    profile_rz: Sequence[tuple[float, float]],
    segments: int = 32,
    mat_index: int = 0,
    smooth: bool = True,
    cap_bottom: bool = True,
    cap_top: bool = True,
) -> None:
    """Revolve a (radius, z) profile around vertical axis (cx, cy, z)."""
    rings: list[list[bmesh.types.BMVert]] = []
    for r, z in profile_rz:
        if r <= 1e-6:
            # Pole vertex
            v_pole = bm.verts.new((cx, cy, z))
            rings.append([v_pole])
        else:
            ring = []
            for i in range(segments):
                ang = 2.0 * math.pi * i / segments
                ring.append(
                    bm.verts.new((cx + r * math.cos(ang), cy + r * math.sin(ang), z))
                )
            rings.append(ring)

    for k in range(len(rings) - 1):
        r0 = rings[k]
        r1 = rings[k + 1]
        if len(r0) == 1 and len(r1) == segments:
            pole = r0[0]
            for i in range(segments):
                j = (i + 1) % segments
                f = bm.faces.new([pole, r1[i], r1[j]])
                f.material_index = mat_index
                f.smooth = smooth
        elif len(r0) == segments and len(r1) == 1:
            pole = r1[0]
            for i in range(segments):
                j = (i + 1) % segments
                f = bm.faces.new([r0[i], r0[j], pole])
                f.material_index = mat_index
                f.smooth = smooth
        elif len(r0) == segments and len(r1) == segments:
            for i in range(segments):
                j = (i + 1) % segments
                f = bm.faces.new([r0[i], r0[j], r1[j], r1[i]])
                f.material_index = mat_index
                f.smooth = smooth

    if cap_bottom and len(rings[0]) == segments:
        f_b = bm.faces.new(list(reversed(rings[0])))
        f_b.material_index = mat_index
    if cap_top and len(rings[-1]) == segments:
        f_t = bm.faces.new(rings[-1])
        f_t.material_index = mat_index


def add_rounded_segment_prism(
    bm: bmesh.types.BMesh,
    p0: tuple[float, float],
    p1: tuple[float, float],
    half_width: float,
    z0: float,
    z1: float,
    arc_segments: int = 10,
    mat_index: int = 0,
) -> None:
    """Create a stadium-shaped extruded prism connecting p0 and p1 in XY."""
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    base_ang = math.atan2(dy, dx)
    pts: list[tuple[float, float]] = []
    # Semicircle around p1
    for i in range(arc_segments + 1):
        a = base_ang - 0.5 * math.pi + math.pi * i / arc_segments
        pts.append((p1[0] + half_width * math.cos(a), p1[1] + half_width * math.sin(a)))
    # Semicircle around p0
    for i in range(arc_segments + 1):
        a = base_ang + 0.5 * math.pi + math.pi * i / arc_segments
        pts.append((p0[0] + half_width * math.cos(a), p0[1] + half_width * math.sin(a)))
    add_extruded_polygon(bm, pts, z0, z1, mat_index=mat_index, smooth_sides=True)


def add_directed_wall(
    bm: bmesh.types.BMesh,
    p0: tuple[float, float],
    p1: tuple[float, float],
    thickness: float,
    outward_sign: float,
    z0: float,
    z1: float,
    mat_index: int = 0,
    chamfer_top: float = 0.0015,
) -> None:
    """Build a wall whose guiding face sits strictly on segment p0 -> p1.

    ``outward_sign`` (+1 or -1) determines which side of ``(dx, dy)``'s left normal
    receives the wall thickness, keeping the active playfield face exact.
    """
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    seg_len = math.hypot(dx, dy)
    nx = (-dy / seg_len) * outward_sign
    ny = (dx / seg_len) * outward_sign

    q0 = (p0[0] + nx * thickness, p0[1] + ny * thickness)
    q1 = (p1[0] + nx * thickness, p1[1] + ny * thickness)

    pts = [p0, p1, q1, q0] if outward_sign > 0 else [p1, p0, q0, q1]
    if chamfer_top > 0.0 and (z1 - z0) > chamfer_top * 2.0:
        add_extruded_polygon(bm, pts, z0, z1 - chamfer_top, mat_index=mat_index)
        # Tapered chamfer crown
        inset = min(chamfer_top, thickness * 0.35)
        c_p0 = (p0[0] + nx * inset, p0[1] + ny * inset)
        c_p1 = (p1[0] + nx * inset, p1[1] + ny * inset)
        c_q0 = (p0[0] + nx * (thickness - inset), p0[1] + ny * (thickness - inset))
        c_q1 = (p1[0] + nx * (thickness - inset), p1[1] + ny * (thickness - inset))
        pts_top = [c_p0, c_p1, c_q1, c_q0] if outward_sign > 0 else [c_p1, c_p0, c_q0, c_q1]
        bot_v = [bm.verts.new((x, y, z1 - chamfer_top)) for x, y in pts]
        top_v = [bm.verts.new((x, y, z1)) for x, y in pts_top]
        f_top = bm.faces.new(top_v)
        f_top.material_index = mat_index
        for i in range(4):
            j = (i + 1) % 4
            f_s = bm.faces.new([bot_v[i], bot_v[j], top_v[j], top_v[i]])
            f_s.material_index = mat_index
    else:
        add_extruded_polygon(bm, pts, z0, z1, mat_index=mat_index)


# ---------------------------------------------------------------------------
# Sub-Assembly Builders
# ---------------------------------------------------------------------------

def build_cabinet(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build bevelled cabinet walls, floor, side rails, lockdown bar, and gothic backbox."""
    x_in = INNER_WIDTH * 0.5   # 0.2575
    x_out = OUTER_WIDTH * 0.5  # 0.2775
    y_in = INNER_LENGTH * 0.5  # 0.535
    y_out = OUTER_LENGTH * 0.5  # 0.557

    # 1. Cabinet_Floor (sits inside [WALL_BOTTOM_Z, WALL_BOTTOM_Z + FLOOR_THICKNESS])
    bm = bmesh.new()
    add_box(
        bm,
        -x_out,
        x_out,
        -y_out,
        y_out,
        WALL_BOTTOM_Z,
        WALL_BOTTOM_Z + FLOOR_THICKNESS,
        mat_index=0,
        bevel_width=0.002,
    )
    finalize_bmesh_object("Cabinet_Floor", bm, [mats["cabinet_slate"]], col, root)

    # 2. Cabinet_Wall_Left & Right (inner faces strictly flush at x = +-0.2575)
    for side_name, sign in (("Left", -1.0), ("Right", 1.0)):
        bm = bmesh.new()
        xa = sign * x_in
        xb = sign * x_out
        x0, x1 = (min(xa, xb), max(xa, xb))
        add_box(bm, x0, x1, -y_out, y_out, WALL_BOTTOM_Z, WALL_TOP_Z, mat_index=0)
        # Outer decorative bevelled space-cadet recessed frame + gothic buttress ribs
        ox = sign * (x_out + 0.0025)
        ox0, ox1 = (min(xb, ox), max(xb, ox))
        # Upper & lower trim bands along exterior side
        add_box(bm, ox0, ox1, -0.520, 0.520, 0.072, 0.088, mat_index=1, bevel_width=0.001)
        add_box(bm, ox0, ox1, -0.520, 0.520, -0.088, -0.072, mat_index=1, bevel_width=0.001)
        for ry in (-0.48, -0.16, 0.16, 0.48):
            add_box(
                bm,
                ox0,
                ox1,
                ry - 0.014,
                ry + 0.014,
                -0.072,
                0.072,
                mat_index=1,
                bevel_width=0.001,
            )
        finalize_bmesh_object(
            f"Cabinet_Wall_{side_name}",
            bm,
            [mats["cabinet_navy"], mats["trim_brass"]],
            col,
            root,
        )

    # 3. Cabinet_Wall_Front & Rear (inner faces strictly flush at y = +-0.535)
    bm_front = bmesh.new()
    add_box(bm_front, -x_in, x_in, -y_out, -y_in, WALL_BOTTOM_Z, WALL_TOP_Z, mat_index=0)
    # Sculpted space-cadet cathedral coin door & twin glowing reject buttons (avoiding plunger at x=+0.2395)
    add_box(bm_front, -0.140, 0.096, -y_out - 0.005, -y_out, -0.076, 0.056, mat_index=1, bevel_width=0.0018)
    add_box(bm_front, -0.128, 0.084, -y_out - 0.008, -y_out - 0.003, -0.066, 0.046, mat_index=0, bevel_width=0.0012)
    # Twin brass coin-entry bezels + glowing ruby reject jewels
    for cx_btn in (-0.075, 0.031):
        add_box(bm_front, cx_btn - 0.022, cx_btn + 0.022, -y_out - 0.011, -y_out - 0.006, 0.006, 0.034, mat_index=2, bevel_width=0.001)
        add_box(bm_front, cx_btn - 0.012, cx_btn + 0.012, -y_out - 0.013, -y_out - 0.009, 0.012, 0.028, mat_index=3)
        add_box(bm_front, cx_btn - 0.018, cx_btn + 0.018, -y_out - 0.011, -y_out - 0.006, -0.050, -0.022, mat_index=2, bevel_width=0.001)
    # Central space-cadet cathedral crest medallion between coin slots
    add_box(bm_front, -0.032, -0.012, -y_out - 0.011, -y_out - 0.006, -0.046, 0.032, mat_index=2, bevel_width=0.001)
    finalize_bmesh_object(
        "Cabinet_Wall_Front",
        bm_front,
        [mats["cabinet_navy"], mats["cabinet_slate"], mats["trim_brass"], mats["lock_beacon"]],
        col,
        root,
    )

    bm_rear = bmesh.new()
    add_box(bm_rear, -x_in, x_in, y_in, y_out, WALL_BOTTOM_Z, WALL_TOP_Z, mat_index=0)
    finalize_bmesh_object("Cabinet_Wall_Rear", bm_rear, [mats["cabinet_navy"]], col, root)

    # 4. Cabinet_Rail_Left & Right (metallic bevelled side rails)
    for side_name, sign in (("Left", -1.0), ("Right", 1.0)):
        bm = bmesh.new()
        rx0 = sign * (x_in - 0.002)
        rx1 = sign * (x_out + 0.004)
        x0, x1 = (min(rx0, rx1), max(rx0, rx1))
        add_box(bm, x0, x1, -y_in + 0.008, y_out - 0.004, WALL_TOP_Z - 0.004, WALL_TOP_Z + 0.010, mat_index=0, bevel_width=0.0025)
        # Decorative brass rivet ribs along top rail
        for y_stud in (-0.42, -0.22, -0.02, 0.18, 0.38):
            add_cylinder_z(
                bm,
                0.5 * (x0 + x1),
                y_stud,
                WALL_TOP_Z + 0.009,
                WALL_TOP_Z + 0.012,
                0.0045,
                0.0035,
                segments=12,
                mat_index=1,
            )
        finalize_bmesh_object(
            f"Cabinet_Rail_{side_name}",
            bm,
            [mats["trim_chrome"], mats["trim_brass"]],
            col,
            root,
        )

    # 5. Cabinet_Lockdown_Bar (sculpted front palm rest + launch emblem)
    bm = bmesh.new()
    # Sculpted ergonomic profile lofted across X in [-x_out - 0.006, +x_out + 0.006]
    lock_x0, lock_x1 = -(x_out + 0.006), (x_out + 0.006)
    profile_yz = [
        (-0.526, 0.104),
        (-0.526, 0.121),
        (-0.548, 0.123),
        (-0.566, 0.118),
        (-0.573, 0.105),
        (-0.568, 0.091),
        (-0.556, 0.088),
        (-0.556, 0.104),
    ]
    n_p = len(profile_yz)
    v_left = [bm.verts.new((lock_x0, y, z)) for y, z in profile_yz]
    v_right = [bm.verts.new((lock_x1, y, z)) for y, z in profile_yz]
    f_l = bm.faces.new(list(reversed(v_left)))
    f_l.material_index = 0
    f_r = bm.faces.new(v_right)
    f_r.material_index = 0
    for i in range(n_p):
        j = (i + 1) % n_p
        f_s = bm.faces.new([v_left[i], v_left[j], v_right[j], v_right[i]])
        f_s.material_index = 0
        f_s.smooth = True
    # Brass central cathedral plaque on lockdown bar
    add_box(bm, -0.090, 0.046, -0.564, -0.532, 0.120, 0.126, mat_index=1, bevel_width=0.0015)
    # Launch button bezel on front-right above plunger lane
    add_cylinder_z(bm, PLUNGER_CENTER_X, -0.552, 0.120, 0.128, 0.013, 0.011, segments=20, mat_index=1)
    add_cylinder_z(bm, PLUNGER_CENTER_X, -0.552, 0.127, 0.131, 0.008, 0.008, segments=20, mat_index=2)
    finalize_bmesh_object(
        "Cabinet_Lockdown_Bar",
        bm,
        [mats["trim_chrome"], mats["trim_brass"], mats["lock_beacon"]],
        col,
        root,
    )

    # 6. Cabinet_Backbox_Arch (rear gothic pointed arch framing Backglass_StainedGlass)
    bm = bmesh.new()
    arch_y0 = y_in  # 0.535 (flush with rear inner wall, zero protrusion into playfield)
    arch_y1 = y_out + 0.078  # 0.635
    # Base plinth
    add_box(bm, -(x_out + 0.008), x_out + 0.008, arch_y0, arch_y1, 0.090, 0.145, mat_index=0, bevel_width=0.003)
    add_box(bm, -(x_out + 0.011), x_out + 0.011, arch_y0 - 0.004, arch_y1 + 0.004, 0.138, 0.154, mat_index=1, bevel_width=0.002)

    # Gothic pointed arch curve: outer & inner profiles in XZ, extruded along Y
    # Left/right straight pilasters up to springer z = 0.375, then lancet pointed curves meeting at x=0, z=0.625
    def gothic_arch_points(x_half: float, z_spring: float, z_peak: float, segs_per_side: int = 16) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = [(-x_half, 0.145), (-x_half, z_spring)]
        # Right-curving lancet from (-x_half, z_spring) to (0, z_peak)
        for i in range(1, segs_per_side + 1):
            t = i / segs_per_side
            x = -x_half * math.cos(0.5 * math.pi * t)
            z = z_spring + (z_peak - z_spring) * math.sin(0.5 * math.pi * t) ** 0.82
            pts.append((x, z))
        # Symmetric right-side down to (+x_half, z_spring)
        for i in range(1, segs_per_side + 1):
            t = i / segs_per_side
            x = x_half * math.sin(0.5 * math.pi * t)
            z = z_spring + (z_peak - z_spring) * math.cos(0.5 * math.pi * t) ** 0.82
            pts.append((x, z))
        pts.append((x_half, 0.145))
        return pts

    outer_arch = gothic_arch_points(x_out + 0.006, 0.380, 0.625, 16)
    inner_arch = gothic_arch_points(x_in - 0.025, 0.365, 0.560, 16)
    # Build closed ring face-by-face extruded in Y
    n_arch = len(outer_arch)
    f_out_v = [bm.verts.new((x, arch_y0, z)) for x, z in outer_arch]
    f_in_v = [bm.verts.new((x, arch_y0, z)) for x, z in inner_arch]
    b_out_v = [bm.verts.new((x, arch_y1, z)) for x, z in outer_arch]
    b_in_v = [bm.verts.new((x, arch_y1, z)) for x, z in inner_arch]

    for i in range(n_arch - 1):
        # Front face (facing -Y toward player)
        f_front = bm.faces.new([f_out_v[i], f_in_v[i], f_in_v[i + 1], f_out_v[i + 1]])
        f_front.material_index = 0
        # Back face (+Y)
        f_back = bm.faces.new([b_out_v[i + 1], b_in_v[i + 1], b_in_v[i], b_out_v[i]])
        f_back.material_index = 0
        # Outer rim
        f_orim = bm.faces.new([f_out_v[i], f_out_v[i + 1], b_out_v[i + 1], b_out_v[i]])
        f_orim.material_index = 1 if (i == 0 or i == n_arch - 2) else 0
        f_orim.smooth = True
        # Inner bevel rim (brass framing around stained glass)
        f_irim = bm.faces.new([f_in_v[i + 1], f_in_v[i], b_in_v[i], b_in_v[i + 1]])
        f_irim.material_index = 1
        f_irim.smooth = True

    # Rear solid backing board behind the stained-glass backbox
    for i in range(1, n_arch - 1):
        f_solid = bm.faces.new([b_in_v[i], b_in_v[i + 1], b_in_v[0]])
        f_solid.material_index = 0

    # Brass space-cadet cathedral spire finial at apex (0, arch_center_y, 0.625)
    arch_cy = 0.5 * (arch_y0 + arch_y1)
    add_revolved_profile_z(
        bm,
        0.0,
        arch_cy,
        [(0.022, 0.615), (0.028, 0.626), (0.014, 0.642), (0.018, 0.654), (0.005, 0.675), (0.0, 0.692)],
        segments=16,
        mat_index=1,
    )
    # Flanking buttress finials on pilasters
    for sx in (-1.0, 1.0):
        add_box(bm, sx * (x_out + 0.002) - 0.014, sx * (x_out + 0.002) + 0.014, arch_y0 - 0.006, arch_y1 + 0.002, 0.145, 0.390, mat_index=0, bevel_width=0.002)
        add_revolved_profile_z(
            bm,
            sx * (x_out + 0.002),
            arch_cy,
            [(0.014, 0.390), (0.017, 0.402), (0.008, 0.422), (0.0, 0.440)],
            segments=12,
            mat_index=1,
        )

    finalize_bmesh_object(
        "Cabinet_Backbox_Arch",
        bm,
        [mats["cabinet_navy"], mats["trim_brass"]],
        col,
        root,
    )

    # 7. Backglass_StainedGlass (recessed single-material panel so Three.js emissive glass textures map cleanly)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()
    bg_y0 = arch_y0 + 0.020  # 0.555
    bg_y1 = bg_y0 + 0.008
    glass_arch = gothic_arch_points(x_in - 0.023, 0.365, 0.562, 16)
    cx_bg, cz_bg = 0.0, 0.345

    inner_r_bg = 0.058
    mid_r_bg = 0.118
    rose_n = 16
    c_f = bm.verts.new((cx_bg, bg_y0, cz_bg))
    c_b = bm.verts.new((cx_bg, bg_y1, cz_bg))
    in_ring_f = [
        bm.verts.new((cx_bg + inner_r_bg * math.cos(2.0 * math.pi * k / rose_n), bg_y0, cz_bg + inner_r_bg * math.sin(2.0 * math.pi * k / rose_n)))
        for k in range(rose_n)
    ]
    in_ring_b = [
        bm.verts.new((cx_bg + inner_r_bg * math.cos(2.0 * math.pi * k / rose_n), bg_y1, cz_bg + inner_r_bg * math.sin(2.0 * math.pi * k / rose_n)))
        for k in range(rose_n)
    ]
    mid_ring_f = [
        bm.verts.new((cx_bg + mid_r_bg * math.cos(2.0 * math.pi * k / rose_n), bg_y0, cz_bg + mid_r_bg * math.sin(2.0 * math.pi * k / rose_n)))
        for k in range(rose_n)
    ]
    mid_ring_b = [
        bm.verts.new((cx_bg + mid_r_bg * math.cos(2.0 * math.pi * k / rose_n), bg_y1, cz_bg + mid_r_bg * math.sin(2.0 * math.pi * k / rose_n)))
        for k in range(rose_n)
    ]

    for k in range(rose_n):
        kn = (k + 1) % rose_n
        bm.faces.new([c_f, in_ring_f[kn], in_ring_f[k]]).material_index = 0
        bm.faces.new([c_b, in_ring_b[k], in_ring_b[kn]]).material_index = 0
        bm.faces.new([in_ring_f[k], in_ring_f[kn], mid_ring_f[kn], mid_ring_f[k]]).material_index = 0
        bm.faces.new([in_ring_b[kn], in_ring_b[k], mid_ring_b[k], mid_ring_b[kn]]).material_index = 0

    arch_f = [bm.verts.new((x, bg_y0, z)) for x, z in glass_arch]
    arch_b = [bm.verts.new((x, bg_y1, z)) for x, z in glass_arch]

    def nearest_mid_idx(x: float, z: float) -> int:
        ang = math.atan2(z - cz_bg, x - cx_bg) % (2.0 * math.pi)
        return int(round(ang / (2.0 * math.pi) * rose_n)) % rose_n

    n_ga = len(glass_arch)
    for i in range(n_ga):
        inext = (i + 1) % n_ga
        m0 = nearest_mid_idx(glass_arch[i][0], glass_arch[i][1])
        m1 = nearest_mid_idx(glass_arch[inext][0], glass_arch[inext][1])
        if m0 == m1:
            bm.faces.new([mid_ring_f[m0], arch_f[inext], arch_f[i]]).material_index = 0
            bm.faces.new([mid_ring_b[m0], arch_b[i], arch_b[inext]]).material_index = 0
        else:
            bm.faces.new([mid_ring_f[m0], mid_ring_f[m1], arch_f[inext], arch_f[i]]).material_index = 0
            bm.faces.new([mid_ring_b[m1], mid_ring_b[m0], arch_b[i], arch_b[inext]]).material_index = 0

    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            u = (co.x / (2.0 * (x_in - 0.023))) + 0.5
            v = (co.z - 0.145) / (0.562 - 0.145)
            loop[uv_layer].uv = (u, v)

    finalize_bmesh_object(
        "Backglass_StainedGlass",
        bm,
        [mats["backglass_emissive"]],
        col,
        root,
    )

    # Separate Backglass_Tracery sibling keeps gothic lead mullions dark over emissive glass
    bm_tr = bmesh.new()
    for mx in (-0.135, 0.0, 0.135):
        z_top_m = 0.556 if abs(mx) < 0.01 else 0.440
        add_box(bm_tr, mx - 0.004, mx + 0.004, bg_y0 - 0.003, bg_y0 + 0.001, 0.145, z_top_m, mat_index=0)
    for r_came in (inner_r_bg, mid_r_bg):
        for i in range(rose_n):
            a0 = 2.0 * math.pi * i / rose_n
            a1 = 2.0 * math.pi * (i + 1) / rose_n
            x0r, z0r = cx_bg + r_came * math.cos(a0), cz_bg + r_came * math.sin(a0)
            x1r, z1r = cx_bg + r_came * math.cos(a1), cz_bg + r_came * math.sin(a1)
            r_in_c = r_came - 0.0045
            p0_r = bm_tr.verts.new((x0r, bg_y0 - 0.0035, z0r))
            p1_r = bm_tr.verts.new((x1r, bg_y0 - 0.0035, z1r))
            p2_r = bm_tr.verts.new((cx_bg + r_in_c * math.cos(a1), bg_y0 - 0.0035, cz_bg + r_in_c * math.sin(a1)))
            p3_r = bm_tr.verts.new((cx_bg + r_in_c * math.cos(a0), bg_y0 - 0.0035, cz_bg + r_in_c * math.sin(a0)))
            bm_tr.faces.new([p0_r, p1_r, p2_r, p3_r]).material_index = 0
    for k in range(8):
        a = 2.0 * math.pi * k / 8.0
        ca, sa = math.cos(a), math.sin(a)
        nx, nz = -sa * 0.0022, ca * 0.0022
        x_end, z_end = cx_bg + mid_r_bg * ca, cz_bg + mid_r_bg * sa
        p_s = [
            bm_tr.verts.new((cx_bg - nx, bg_y0 - 0.0032, cz_bg - nz)),
            bm_tr.verts.new((cx_bg + nx, bg_y0 - 0.0032, cz_bg + nz)),
            bm_tr.verts.new((x_end + nx, bg_y0 - 0.0032, z_end + nz)),
            bm_tr.verts.new((x_end - nx, bg_y0 - 0.0032, z_end - nz)),
        ]
        bm_tr.faces.new(p_s).material_index = 0

    finalize_bmesh_object("Backglass_Tracery", bm_tr, [mats["lead_came"]], col, root)


def build_playfield_and_rose_window(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build Playfield_Deck with [0,1] top UVs and flush RoseWindow_Insert + gothic tracery."""
    x_half = INNER_WIDTH * 0.5   # 0.2575
    y_half = INNER_LENGTH * 0.5  # 0.535

    bm = bmesh.new()
    add_box(bm, -x_half, x_half, -y_half, y_half, -PLAYFIELD_THICKNESS, 0.0, mat_index=0)
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        if face.normal.z > 0.9:
            for loop in face.loops:
                co = loop.vert.co
                u = (co.x + x_half) / INNER_WIDTH
                v = (co.y + y_half) / INNER_LENGTH
                loop[uv_layer].uv = (u, v)
        else:
            for loop in face.loops:
                loop[uv_layer].uv = (0.01, 0.01)

    finalize_bmesh_object("Playfield_Deck", bm, [mats["playfield_deck"]], col, root)

    # Flush central gothic RoseWindow_Insert at (-0.022, +0.040, +0.001), r = 0.095 m
    rw_x, rw_y, rw_z = MAIN_CENTER_X, 0.040, 0.001
    rw_r = 0.095
    bm_rw = bmesh.new()
    add_cylinder_z(bm_rw, 0.0, 0.0, -0.0006, 0.0003, rw_r, rw_r, segments=48, mat_index=0, smooth=True)
    finalize_bmesh_object(
        "RoseWindow_Insert",
        bm_rw,
        [mats["glass_rose"]],
        col,
        root,
        location=(rw_x, rw_y, rw_z),
        planar_uv_bounds=(-rw_r, rw_r, -rw_r, rw_r),
    )

    # Sibling gothic lead-came tracery overlay framing RoseWindow_Insert cleanly
    bm_frame = bmesh.new()
    # Outer brass/lead bezel ring
    segs = 48
    r_in, r_out = 0.091, 0.098
    for i in range(segs):
        a0 = 2.0 * math.pi * i / segs
        a1 = 2.0 * math.pi * (i + 1) / segs
        pts = [
            (r_in * math.cos(a0), r_in * math.sin(a0)),
            (r_out * math.cos(a0), r_out * math.sin(a0)),
            (r_out * math.cos(a1), r_out * math.sin(a1)),
            (r_in * math.cos(a1), r_in * math.sin(a1)),
        ]
        add_extruded_polygon(bm_frame, pts, -0.0005, 0.0007, mat_index=0)
    # Inner hub ring + middle trefoil tracery ring
    r_hub_in, r_hub_out = 0.024, 0.029
    for i in range(24):
        a0 = 2.0 * math.pi * i / 24
        a1 = 2.0 * math.pi * (i + 1) / 24
        pts = [
            (r_hub_in * math.cos(a0), r_hub_in * math.sin(a0)),
            (r_hub_out * math.cos(a0), r_hub_out * math.sin(a0)),
            (r_hub_out * math.cos(a1), r_hub_out * math.sin(a1)),
            (r_hub_in * math.cos(a1), r_hub_in * math.sin(a1)),
        ]
        add_extruded_polygon(bm_frame, pts, -0.0005, 0.0006, mat_index=1)
    r_mid_in, r_mid_out = 0.056, 0.060
    for i in range(36):
        a0 = 2.0 * math.pi * i / 36
        a1 = 2.0 * math.pi * (i + 1) / 36
        pts = [
            (r_mid_in * math.cos(a0), r_mid_in * math.sin(a0)),
            (r_mid_out * math.cos(a0), r_mid_out * math.sin(a0)),
            (r_mid_out * math.cos(a1), r_mid_out * math.sin(a1)),
            (r_mid_in * math.cos(a1), r_mid_in * math.sin(a1)),
        ]
        add_extruded_polygon(bm_frame, pts, -0.0005, 0.0006, mat_index=0)
    # 12 radial tracery spokes
    for k in range(12):
        ang = 2.0 * math.pi * k / 12.0
        p0 = (0.027 * math.cos(ang), 0.027 * math.sin(ang))
        p1 = (0.092 * math.cos(ang), 0.092 * math.sin(ang))
        add_rounded_segment_prism(bm_frame, p0, p1, 0.0014, -0.0005, 0.0005, arc_segments=4, mat_index=1)

    finalize_bmesh_object(
        "RoseWindow_Frame",
        bm_frame,
        [mats["trim_brass"], mats["lead_came"]],
        col,
        root,
        location=(rw_x, rw_y, rw_z),
    )


def build_plunger_assembly(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build Plunger_Lane_Divider, Plunger_Housing, Plunger_Spring, and Plunger_Rod."""
    # 1. Plunger_Lane_Divider (x = +0.2175, y in [-0.535, +0.265], h = 0.042)
    bm = bmesh.new()
    half_t = DIVIDER_THICKNESS * 0.5  # 0.004
    # Main straight rail from front inner wall -0.535 up to +0.261, plus rounded nose tip to +0.265
    add_box(
        bm,
        DIVIDER_X - half_t,
        DIVIDER_X + half_t,
        DIVIDER_Y_MIN,
        DIVIDER_Y_MAX - half_t,
        0.0,
        DIVIDER_HEIGHT - 0.004,
        mat_index=0,
    )
    add_cylinder_z(
        bm,
        DIVIDER_X,
        DIVIDER_Y_MAX - half_t,
        0.0,
        DIVIDER_HEIGHT - 0.004,
        half_t,
        half_t,
        segments=16,
        mat_index=0,
    )
    # Brass top cap rail
    add_box(
        bm,
        DIVIDER_X - half_t + 0.0006,
        DIVIDER_X + half_t - 0.0006,
        DIVIDER_Y_MIN,
        DIVIDER_Y_MAX - half_t,
        DIVIDER_HEIGHT - 0.004,
        DIVIDER_HEIGHT,
        mat_index=1,
        bevel_width=0.0008,
    )
    add_cylinder_z(
        bm,
        DIVIDER_X,
        DIVIDER_Y_MAX - half_t,
        DIVIDER_HEIGHT - 0.004,
        DIVIDER_HEIGHT,
        half_t - 0.0006,
        half_t - 0.0012,
        segments=16,
        mat_index=1,
    )
    finalize_bmesh_object(
        "Plunger_Lane_Divider",
        bm,
        [mats["cabinet_slate"], mats["trim_brass"]],
        col,
        root,
    )

    # 2. Plunger_Housing collar at front wall (x=+0.2395, y=-0.535..-0.562, z=0.0135)
    bm_h = bmesh.new()
    px, pz = PLUNGER_CENTER_X, 0.0135
    # Collar oriented along Y axis: build revolved around Z then rotate X by -90 deg
    add_revolved_profile_z(
        bm_h,
        0.0,
        0.0,
        [
            (0.0075, -0.028),
            (0.0175, -0.028),
            (0.0175, -0.022),
            (0.0120, -0.020),
            (0.0120, 0.008),
            (0.0155, 0.008),
            (0.0155, 0.012),
            (0.0075, 0.012),
        ],
        segments=24,
        mat_index=0,
        cap_bottom=False,
        cap_top=False,
    )
    # Outer brass flange bezel
    add_revolved_profile_z(
        bm_h,
        0.0,
        0.0,
        [(0.015, -0.032), (0.020, -0.032), (0.020, -0.027), (0.015, -0.027)],
        segments=24,
        mat_index=1,
        cap_bottom=False,
        cap_top=False,
    )
    bmesh.ops.rotate(
        bm_h,
        verts=bm_h.verts,
        cent=(0.0, 0.0, 0.0),
        matrix=Matrix.Rotation(math.radians(-90.0), 3, "X"),
    )
    finalize_bmesh_object(
        "Plunger_Housing",
        bm_h,
        [mats["trim_chrome"], mats["trim_brass"]],
        col,
        root,
        location=(px, -0.535, pz),
    )

    # 3. Plunger_Spring helical coil along y in [-0.528, -0.483]
    bm_sp = bmesh.new()
    turns = 9.0
    steps = 108
    ring_segs = 8
    coil_r = 0.0088
    wire_r = 0.0013
    y_start, y_end = -0.528, -0.483
    prev_ring: list[bmesh.types.BMVert] | None = None
    for s in range(steps + 1):
        t = s / steps
        theta = 2.0 * math.pi * turns * t
        yc = y_start + (y_end - y_start) * t
        xc = px + coil_r * math.cos(theta)
        zc = pz + coil_r * math.sin(theta)
        # Tangent vector of helix
        tx = -coil_r * 2.0 * math.pi * turns * math.sin(theta)
        ty = y_end - y_start
        tz = coil_r * 2.0 * math.pi * turns * math.cos(theta)
        t_vec = Vector((tx, ty, tz)).normalized()
        n_vec = Vector((math.cos(theta), 0.0, math.sin(theta))).normalized()
        b_vec = t_vec.cross(n_vec).normalized()
        ring = []
        for k in range(ring_segs):
            a = 2.0 * math.pi * k / ring_segs
            pt = Vector((xc, yc, zc)) + (n_vec * math.cos(a) + b_vec * math.sin(a)) * wire_r
            ring.append(bm_sp.verts.new(pt))
        if prev_ring is not None:
            for k in range(ring_segs):
                kn = (k + 1) % ring_segs
                f = bm_sp.faces.new([prev_ring[k], prev_ring[kn], ring[kn], ring[k]])
                f.material_index = 0
                f.smooth = True
        prev_ring = ring
    finalize_bmesh_object("Plunger_Spring", bm_sp, [mats["trim_chrome"]], col, root)

    # 4. Plunger_Rod (movable; origin at (0.2395, -0.510, 0.0135), local Y runs -0.078..+0.038)
    # World Y spans -0.588..-0.472; active tip inside lane is -0.540..-0.472
    bm_rod = bmesh.new()
    # Chrome rod shaft (local z along shaft before -90 deg X rotation)
    add_revolved_profile_z(
        bm_rod,
        0.0,
        0.0,
        [
            (0.0, -0.082),
            (0.012, -0.080),
            (0.015, -0.072),
            (0.009, -0.062),
            (0.0045, -0.060),
            (0.0045, 0.030),
        ],
        segments=20,
        mat_index=0,
    )
    # Rubber striker tip (local +0.030..+0.038 -> world y = -0.480..-0.472)
    add_revolved_profile_z(
        bm_rod,
        0.0,
        0.0,
        [
            (0.006, 0.029),
            (0.0085, 0.031),
            (0.0085, 0.037),
            (0.006, 0.0385),
            (0.0, 0.0385),
        ],
        segments=20,
        mat_index=1,
    )
    # Brass grip collar on outer knob
    add_revolved_profile_z(
        bm_rod,
        0.0,
        0.0,
        [(0.0145, -0.075), (0.0156, -0.075), (0.0156, -0.069), (0.0145, -0.069)],
        segments=20,
        mat_index=2,
        cap_bottom=False,
        cap_top=False,
    )
    bmesh.ops.rotate(
        bm_rod,
        verts=bm_rod.verts,
        cent=(0.0, 0.0, 0.0),
        matrix=Matrix.Rotation(math.radians(-90.0), 3, "X"),
    )
    finalize_bmesh_object(
        "Plunger_Rod",
        bm_rod,
        [mats["trim_chrome"], mats["rubber"], mats["trim_brass"]],
        col,
        root,
        location=(px, -0.510, pz),
    )


def build_upper_arch_and_rollovers(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build smooth elliptical Upper_Orbit_Arch and 4 Rollover_Divider_1..4."""
    # Upper_Orbit_Arch: ellipse cx=0.0, cy=+0.265, rx=0.2575, ry=0.265
    bm = bmesh.new()
    cx, cy = 0.0, 0.265
    rx, ry = 0.2575, 0.265
    segs = 48
    arch_h = 0.045
    wall_t = 0.012
    x_clamp = 0.2575
    y_clamp = 0.535

    inner_pts: list[tuple[float, float]] = []
    outer_pts: list[tuple[float, float]] = []
    for i in range(segs + 1):
        ang = math.pi * i / segs  # 0 (right +X) -> pi (left -X)
        ca, sa = math.cos(ang), math.sin(ang)
        ix = cx + rx * ca
        iy = cy + ry * sa
        inner_pts.append((ix, iy))
        # Outward normal to ellipse
        nx, ny = ca / rx, sa / ry
        n_len = math.hypot(nx, ny)
        nx /= n_len
        ny /= n_len
        ox = max(-x_clamp, min(x_clamp, ix + nx * wall_t))
        oy = min(y_clamp, iy + ny * wall_t)
        outer_pts.append((ox, oy))

    # Extrude arch band cleanly
    in_bot = [bm.verts.new((x, y, 0.0)) for x, y in inner_pts]
    in_top = [bm.verts.new((x, y, arch_h)) for x, y in inner_pts]
    out_bot = [bm.verts.new((x, y, 0.0)) for x, y in outer_pts]
    out_top = [bm.verts.new((x, y, arch_h)) for x, y in outer_pts]

    for i in range(segs):
        f_in = bm.faces.new([in_bot[i], in_top[i], in_top[i + 1], in_bot[i + 1]])
        f_in.material_index = 0
        f_in.smooth = True
        f_out = bm.faces.new([out_bot[i + 1], out_top[i + 1], out_top[i], out_bot[i]])
        f_out.material_index = 0
        f_out.smooth = True
        f_top = bm.faces.new([in_top[i], out_top[i], out_top[i + 1], in_top[i + 1]])
        f_top.material_index = 1
        f_bot = bm.faces.new([out_bot[i], in_bot[i], in_bot[i + 1], out_bot[i + 1]])
        f_bot.material_index = 0

    # End caps at right (+0.2575, 0.265) and left (-0.2575, 0.265)
    f_end_r = bm.faces.new([in_bot[0], out_bot[0], out_top[0], in_top[0]])
    f_end_r.material_index = 1
    f_end_l = bm.faces.new([out_bot[-1], in_bot[-1], in_top[-1], out_top[-1]])
    f_end_l.material_index = 1

    # Fill decorative spandrel corners behind the ellipse arch up to (+-0.2575, +0.535)
    for side_sign, start_i, end_i in ((1.0, 0, segs // 2), (-1.0, segs // 2, segs)):
        corner_x = side_sign * x_clamp
        corner_y = y_clamp
        v_corner_bot = bm.verts.new((corner_x, corner_y, 0.0))
        v_corner_top = bm.verts.new((corner_x, corner_y, 0.030))
        sp_bot = [bm.verts.new((x, y, 0.0)) for x, y in outer_pts[start_i : end_i + 1]]
        sp_top = [bm.verts.new((x, y, 0.030)) for x, y in outer_pts[start_i : end_i + 1]]
        for k in range(len(sp_top) - 1):
            if side_sign > 0:
                f_sp = bm.faces.new([sp_top[k], v_corner_top, sp_top[k + 1]])
            else:
                f_sp = bm.faces.new([sp_top[k + 1], v_corner_top, sp_top[k]])
            f_sp.material_index = 2
            # Vertical outer perimeter closure
        # Outer wall edges at corner
        if side_sign > 0:
            bm.faces.new([sp_bot[0], v_corner_bot, v_corner_top, sp_top[0]]).material_index = 2
            bm.faces.new([v_corner_bot, sp_bot[-1], sp_top[-1], v_corner_top]).material_index = 2
        else:
            bm.faces.new([v_corner_bot, sp_bot[0], sp_top[0], v_corner_top]).material_index = 2
            bm.faces.new([sp_bot[-1], v_corner_bot, v_corner_top, sp_top[-1]]).material_index = 2

    finalize_bmesh_object(
        "Upper_Orbit_Arch",
        bm,
        [mats["trim_chrome"], mats["trim_brass"], mats["cabinet_slate"]],
        col,
        root,
    )

    # 4 Rollover Lane Dividers (x = -0.127, -0.057, +0.013, +0.083; y in [0.365, 0.455])
    div_xs = (-0.127, -0.057, 0.013, 0.083)
    for idx, dx in enumerate(div_xs, start=1):
        bm_d = bmesh.new()
        add_rounded_segment_prism(
            bm_d,
            (dx, 0.369),
            (dx, 0.451),
            0.004,
            0.0,
            0.030,
            arc_segments=10,
            mat_index=0,
        )
        # Brass gothic crown strip + small spire finials
        add_rounded_segment_prism(
            bm_d,
            (dx, 0.371),
            (dx, 0.449),
            0.0032,
            0.030,
            0.034,
            arc_segments=10,
            mat_index=1,
        )
        for fy in (0.375, 0.445):
            add_revolved_profile_z(
                bm_d,
                dx,
                fy,
                [(0.0035, 0.034), (0.0018, 0.039), (0.0, 0.042)],
                segments=10,
                mat_index=1,
            )
        finalize_bmesh_object(
            f"Rollover_Divider_{idx}",
            bm_d,
            [mats["trim_chrome"], mats["trim_brass"]],
            col,
            root,
        )


def build_pop_bumpers(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build 3 sculpted pop bumpers with metallic skirt bases and stained-glass dome caps."""
    specs = [
        ("Bumper_Top", (-0.022, 0.240, 0.0), mats["bumper_top_cap"]),
        ("Bumper_Left", (-0.112, 0.125, 0.0), mats["bumper_left_cap"]),
        ("Bumper_Right", (0.068, 0.125, 0.0), mats["bumper_right_cap"]),
    ]
    for name, pos, cap_mat in specs:
        # Base & actuator skirt (r = 0.030 max, height up to z = 0.025)
        bm_base = bmesh.new()
        # Playfield flange ring
        add_cylinder_z(bm_base, 0.0, 0.0, 0.0, 0.004, 0.030, 0.029, segments=32, mat_index=0)
        # Flared chrome actuator skirt
        add_cylinder_z(bm_base, 0.0, 0.0, 0.004, 0.011, 0.0285, 0.021, segments=32, mat_index=0)
        # Rubber impact bumper ring at ball equator z=0.0135
        add_cylinder_z(bm_base, 0.0, 0.0, 0.010, 0.017, 0.028, 0.028, segments=32, mat_index=1)
        # Central brass lamp housing column
        add_cylinder_z(bm_base, 0.0, 0.0, 0.015, 0.025, 0.015, 0.015, segments=24, mat_index=2)

        bumper_obj = finalize_bmesh_object(
            name,
            bm_base,
            [mats["trim_chrome"], mats["rubber"], mats["trim_brass"]],
            col,
            root,
            location=pos,
        )

        # Translucent stained-glass sculpted dome cap child: r = 0.030, top at h = 0.040
        bm_cap = bmesh.new()
        add_revolved_profile_z(
            bm_cap,
            0.0,
            0.0,
            [
                (0.014, 0.021),
                (0.027, 0.022),
                (0.030, 0.025),
                (0.0295, 0.029),
                (0.025, 0.034),
                (0.016, 0.0382),
                (0.006, 0.0398),
                (0.0, 0.040),
            ],
            segments=32,
            mat_index=0,
            smooth=True,
            cap_bottom=True,
            cap_top=False,
        )
        finalize_bmesh_object(
            f"{name}_Cap",
            bm_cap,
            [cap_mat],
            col,
            bumper_obj,
            location=(0.0, 0.0, 0.0),
            smooth_all=True,
            planar_uv_bounds=(-0.030, 0.030, -0.030, 0.030),
        )


def build_slingshots_and_apron_guides(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build triangular Slingshot_Left/Right, apron funnel walls, and lower drain guides."""
    sling_defs = [
        ("Slingshot_Left", [(-0.195, -0.165), (-0.195, -0.275), (-0.130, -0.265)]),
        ("Slingshot_Right", [(0.151, -0.165), (0.151, -0.275), (0.086, -0.265)]),
    ]
    for name, verts_xy in sling_defs:
        bm = bmesh.new()
        # Corner steel posts
        for vx, vy in verts_xy:
            add_cylinder_z(bm, vx, vy, 0.0, 0.025, 0.0055, 0.0055, segments=16, mat_index=0)
            add_cylinder_z(bm, vx, vy, 0.025, 0.032, 0.0045, 0.0035, segments=16, mat_index=1)

        # Ensure CCW vertex order for extrusion
        ax, ay = verts_xy[0]
        bx, by = verts_xy[1]
        cx, cy = verts_xy[2]
        area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        ccw = verts_xy if area2 > 0 else [verts_xy[0], verts_xy[2], verts_xy[1]]

        # Rubber kicker band spanning the triangle perimeter at ball equator
        for i in range(3):
            p0 = ccw[i]
            p1 = ccw[(i + 1) % 3]
            add_rounded_segment_prism(bm, p0, p1, 0.0042, 0.004, 0.018, arc_segments=8, mat_index=2)

        # Inner dark base housing + glowing gothic top plaque
        add_extruded_polygon(bm, ccw, 0.0, 0.022, mat_index=3)
        add_extruded_polygon(bm, ccw, 0.022, 0.028, mat_index=4)
        finalize_bmesh_object(
            name,
            bm,
            [
                mats["trim_chrome"],
                mats["trim_brass"],
                mats["rubber"],
                mats["cabinet_navy"],
                mats["slingshot_top"],
            ],
            col,
            root,
        )

    # Metallic Apron Funnel Walls guiding balls onto left/right flippers
    # Left: (-0.2575, -0.305) -> (-0.114, -0.345), stopping tangent to hub at (-0.125, -0.342)
    bm_al = bmesh.new()
    add_directed_wall(
        bm_al,
        (-0.2575, -0.305),
        (-0.1246, -0.3420),
        thickness=0.010,
        outward_sign=-1.0,  # thickness extends -Y toward front apron, keeping upper face exact
        z0=0.0,
        z1=0.028,
        mat_index=0,
    )
    add_cylinder_z(bm_al, -0.125, -0.347, 0.0, 0.031, 0.006, 0.005, segments=16, mat_index=1)
    finalize_bmesh_object("Apron_Guide_Left", bm_al, [mats["trim_chrome"], mats["trim_brass"]], col, root)

    # Right: (+0.2135, -0.305) -> (+0.070, -0.345), stopping tangent to hub at (+0.0806, -0.342)
    bm_ar = bmesh.new()
    add_directed_wall(
        bm_ar,
        (0.2135, -0.305),
        (0.0806, -0.3420),
        thickness=0.010,
        outward_sign=1.0,  # thickness extends -Y toward front apron
        z0=0.0,
        z1=0.028,
        mat_index=0,
    )
    add_cylinder_z(bm_ar, 0.081, -0.347, 0.0, 0.031, 0.006, 0.005, segments=16, mat_index=1)
    finalize_bmesh_object("Apron_Guide_Right", bm_ar, [mats["trim_chrome"], mats["trim_brass"]], col, root)

    # Lower Drain Gutter Guides funneling balls below flippers into drainSensor (-0.022, -0.475)
    bm_dl = bmesh.new()
    add_directed_wall(
        bm_dl,
        (-0.254, -0.375),
        (-0.128, -0.528),
        thickness=0.009,
        outward_sign=-1.0,
        z0=0.0,
        z1=0.026,
        mat_index=0,
    )
    # Recessed decorative apron shield plate strictly behind the drain guide
    add_extruded_polygon(
        bm_dl,
        [(-0.2575, -0.535), (-0.132, -0.535), (-0.2575, -0.380)],
        0.0,
        0.018,
        mat_index=1,
    )
    finalize_bmesh_object("Drain_Guide_Left", bm_dl, [mats["trim_chrome"], mats["cabinet_navy"]], col, root)

    bm_dr = bmesh.new()
    add_directed_wall(
        bm_dr,
        (0.210, -0.375),
        (0.084, -0.528),
        thickness=0.009,
        outward_sign=1.0,
        z0=0.0,
        z1=0.026,
        mat_index=0,
    )
    add_extruded_polygon(
        bm_dr,
        [(0.088, -0.535), (0.2135, -0.535), (0.2135, -0.380)],
        0.0,
        0.018,
        mat_index=1,
    )
    finalize_bmesh_object("Drain_Guide_Right", bm_dr, [mats["trim_chrome"], mats["cabinet_navy"]], col, root)


def build_drop_targets(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build 3 animated DropTarget_1..3 meshes plus static DropTarget_Bank_Frame."""
    # Static mounting bezel tucked behind targets at x = -0.236..-0.244
    bm_bank = bmesh.new()
    add_box(bm_bank, -0.246, -0.235, -0.095, 0.085, 0.0, 0.008, mat_index=0, bevel_width=0.001)
    add_box(bm_bank, -0.248, -0.240, -0.095, 0.085, 0.008, 0.036, mat_index=1, bevel_width=0.001)
    finalize_bmesh_object(
        "DropTarget_Bank_Frame",
        bm_bank,
        [mats["cabinet_slate"], mats["trim_brass"]],
        col,
        root,
    )

    target_ys = (0.055, -0.005, -0.065)
    for idx, ty in enumerate(target_ys, start=1):
        bm = bmesh.new()
        # Canonical extents: 0.012 (X) x 0.042 (Y) x 0.034 (Z)
        add_box(bm, -0.006, 0.006, -0.021, 0.021, 0.0, 0.032, mat_index=0, bevel_width=0.0012)
        # Raised luminous cathedral emblem face on +X side
        add_box(bm, 0.004, 0.0064, -0.014, 0.014, 0.006, 0.027, mat_index=1)
        # Brass top crest
        add_box(bm, -0.005, 0.005, -0.019, 0.019, 0.031, 0.034, mat_index=2, bevel_width=0.0008)
        finalize_bmesh_object(
            f"DropTarget_{idx}",
            bm,
            [mats["drop_target"], mats["trim_brass"], mats["trim_chrome"]],
            col,
            root,
            location=(-0.228, ty, 0.0),
        )


def catmull_rom_point(
    p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: float
) -> Vector:
    """Evaluate a centripetal-like uniform Catmull-Rom spline segment for t in [0, 1]."""
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def build_ramp_and_multiball_lock(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build elevated U-channel Ramp_StainedGlass, support brackets, and Multiball_Lock_Pocket."""
    # Spline control points from entry (-0.155, +0.295, 0.002) -> peak 0.068 -> exit (-0.215, -0.210, 0.005)
    # Wide turn radius >= 0.045 m avoids inner-rail pinching along upper left arch
    ctrl = [
        Vector((-0.148, 0.235, -0.010)),  # phantom entry tangent guide
        Vector((-0.155, 0.295, 0.002)),   # P0 exact entry
        Vector((-0.156, 0.365, 0.028)),   # P1 smooth climb
        Vector((-0.188, 0.396, 0.052)),   # P2 smooth wide crown inside arch
        Vector((-0.212, 0.325, 0.064)),   # P3 turn downward along left nave
        Vector((-0.194, 0.160, 0.068)),   # P4 peak elevation along left nave
        Vector((-0.188, -0.005, 0.063)),  # P5 high over drop targets (z=0.063 >> 0.034)
        Vector((-0.210, -0.125, 0.030)),  # P6 descent past drop target 3 (-0.086)
        Vector((-0.215, -0.210, 0.005)),  # P7 exact exit feeding left inlane
        Vector((-0.215, -0.285, -0.005)), # phantom exit tangent guide
    ]

    samples_per_seg = 12
    pts: list[Vector] = []
    for seg in range(1, len(ctrl) - 2):
        count = samples_per_seg + (1 if seg == len(ctrl) - 3 else 0)
        for s in range(count):
            t = s / samples_per_seg
            pts.append(catmull_rom_point(ctrl[seg - 1], ctrl[seg], ctrl[seg + 1], ctrl[seg + 2], t))

    # Clamp exact endpoints and peak Z so spec coordinates hold to sub-millimeter precision
    pts[0] = Vector((-0.155, 0.295, 0.002))
    pts[-1] = Vector((-0.215, -0.210, 0.005))
    max_z = max(p.z for p in pts)
    if max_z > 1e-6:
        # Scale heights above entry softly if needed so peak equals exact 0.068 m
        scale_z = (0.068 - 0.002) / (max_z - 0.002)
        for p in pts[1:-1]:
            p.z = 0.002 + (p.z - 0.002) * scale_z

    # Cumulative arc lengths for monotonic UVs
    arc_s = [0.0]
    for i in range(1, len(pts)):
        arc_s.append(arc_s[-1] + (pts[i] - pts[i - 1]).length)
    total_len = max(arc_s[-1], 1e-6)

    # U-channel cross section (8 vertices: outer-left top -> bottom -> outer-right top -> inner-right top -> floor -> inner-left top)
    # Taper inner half-width slightly from 0.021 m down to 0.017 m near exit so right wall stays clear of Slingshot_Left (x=-0.195)
    bm_ramp = bmesh.new()
    uv_layer = bm_ramp.loops.layers.uv.verify()
    floor_t = 0.004
    wall_t = 0.003
    wall_h = 0.018

    cross_rings: list[list[bmesh.types.BMVert]] = []

    for idx, p in enumerate(pts):
        if idx == 0:
            tan = (pts[1] - pts[0]).normalized()
        elif idx == len(pts) - 1:
            tan = (pts[-1] - pts[-2]).normalized()
        else:
            tan = (pts[idx + 1] - pts[idx - 1]).normalized()
        up = Vector((0.0, 0.0, 1.0))
        right = tan.cross(up).normalized()
        # Re-orthogonalize local normal so U-channel floor never twists excessively
        up_ortho = right.cross(tan).normalized()

        # Near exit (traveling -Y), -right points +X toward Slingshot_Left (x=-0.195);
        # taper hw_left slightly on final 22% so outer wall stays cleanly < -0.195.
        u_prog = arc_s[idx] / total_len
        hw_left = 0.021 if u_prog < 0.78 else 0.021 - 0.0045 * ((u_prog - 0.78) / 0.22)
        hw_right = 0.021

        # Lower guardrails smoothly right at entry/exit lips
        lip_scale = 1.0
        if u_prog < 0.05:
            lip_scale = 0.25 + 0.75 * (u_prog / 0.05)
        elif u_prog > 0.94:
            lip_scale = 0.25 + 0.75 * ((1.0 - u_prog) / 0.06)
        cur_wh = wall_h * lip_scale

        # 10-point closed U-channel cross-section in (right_offset, up_offset)
        sec_coords = [
            (-hw_left - wall_t, cur_wh),       # 0: outer-left top
            (-hw_left - wall_t, -floor_t),     # 1: outer-left bottom
            (hw_right + wall_t, -floor_t),     # 2: outer-right bottom
            (hw_right + wall_t, cur_wh),       # 3: outer-right top
            (hw_right, cur_wh),                # 4: inner-right top
            (hw_right, 0.0),                   # 5: inner-right floor corner
            (-hw_left, 0.0),                   # 6: inner-left floor corner
            (-hw_left, cur_wh),                # 7: inner-left top
        ]
        ring = [bm_ramp.verts.new(p + right * r_off + up_ortho * u_off) for r_off, u_off in sec_coords]
        cross_rings.append(ring)

    n_sec = 8
    sec_u = [0.0, 0.16, 0.50, 0.84, 1.0, 0.85, 0.50, 0.15]
    for i in range(len(cross_rings) - 1):
        r0 = cross_rings[i]
        r1 = cross_rings[i + 1]
        v0 = (arc_s[i] / total_len) * 4.0
        v1 = (arc_s[i + 1] / total_len) * 4.0
        for k in range(n_sec):
            kn = (k + 1) % n_sec
            f = bm_ramp.faces.new([r0[k], r0[kn], r1[kn], r1[k]])
            f.material_index = 0
            f.smooth = True
            f.loops[0][uv_layer].uv = (sec_u[k], v0)
            f.loops[1][uv_layer].uv = (sec_u[kn], v0)
            f.loops[2][uv_layer].uv = (sec_u[kn], v1)
            f.loops[3][uv_layer].uv = (sec_u[k], v1)

    # Cap start and end cross sections
    f_start = bm_ramp.faces.new(list(reversed(cross_rings[0])))
    f_start.material_index = 0
    f_end = bm_ramp.faces.new(cross_rings[-1])
    f_end.material_index = 0

    finalize_bmesh_object("Ramp_StainedGlass", bm_ramp, [mats["glass_ramp"]], col, root, smooth_all=True)

    # Cantilevered brass/chrome support brackets from side border (x = -0.249) holding the elevated ramp
    bm_sup = bmesh.new()
    support_anchors = [
        ((-0.248, 0.305), (-0.185, 0.305), 0.044),
        ((-0.248, 0.160), (-0.190, 0.160), 0.062),
        ((-0.248, 0.085), (-0.191, 0.085), 0.061),
    ]
    for (ax, ay), (bx, by), z_top in support_anchors:
        add_cylinder_z(bm_sup, ax, ay, 0.0, 0.004, 0.008, 0.007, segments=12, mat_index=1)
        add_cylinder_z(bm_sup, ax, ay, 0.0, z_top, 0.0035, 0.0035, segments=12, mat_index=0)
        add_rounded_segment_prism(bm_sup, (ax, ay), (bx, by), 0.0032, z_top - 0.005, z_top, arc_segments=6, mat_index=1)
    finalize_bmesh_object("Ramp_Supports", bm_sup, [mats["trim_chrome"], mats["trim_brass"]], col, root)

    # Multiball_Lock_Pocket sanctuary scoop at (+0.138, +0.285, 0.0)
    bm_lock = bmesh.new()
    lx, ly = 0.138, 0.285
    r_in, r_out = 0.026, 0.036
    # Horseshoe sanctuary wall spanning angle -30 deg around +Y to +210 deg (opening faces -Y toward flippers)
    arc_segs = 28
    ang_start = math.radians(-20.0)
    ang_end = math.radians(200.0)
    pts_in: list[tuple[float, float]] = []
    pts_out: list[tuple[float, float]] = []
    for i in range(arc_segs + 1):
        a = ang_start + (ang_end - ang_start) * (i / arc_segs)
        pts_in.append((lx + r_in * math.cos(a), ly + r_in * math.sin(a)))
        pts_out.append((lx + r_out * math.cos(a), ly + r_out * math.sin(a)))

    h_scoop = 0.032
    v_in_b = [bm_lock.verts.new((x, y, 0.0)) for x, y in pts_in]
    v_in_t = [bm_lock.verts.new((x, y, h_scoop)) for x, y in pts_in]
    v_out_b = [bm_lock.verts.new((x, y, 0.0)) for x, y in pts_out]
    v_out_t = [bm_lock.verts.new((x, y, h_scoop)) for x, y in pts_out]
    for i in range(arc_segs):
        bm_lock.faces.new([v_in_b[i], v_in_t[i], v_in_t[i + 1], v_in_b[i + 1]]).material_index = 0
        bm_lock.faces.new([v_out_b[i + 1], v_out_t[i + 1], v_out_t[i], v_out_b[i]]).material_index = 0
        bm_lock.faces.new([v_in_t[i], v_out_t[i], v_out_t[i + 1], v_in_t[i + 1]]).material_index = 1
    bm_lock.faces.new([v_in_b[0], v_out_b[0], v_out_t[0], v_in_t[0]]).material_index = 1
    bm_lock.faces.new([v_out_b[-1], v_in_b[-1], v_in_t[-1], v_out_t[-1]]).material_index = 1

    # Vaulted gothic canopy dome roof over the rear sanctuary half
    apex_top = bm_lock.verts.new((lx, ly + 0.008, 0.044))
    apex_bot = bm_lock.verts.new((lx, ly + 0.008, 0.036))
    for i in range(2, arc_segs - 2):
        bm_lock.faces.new([v_out_t[i], v_out_t[i + 1], apex_top]).material_index = 1
        bm_lock.faces.new([v_in_t[i + 1], v_in_t[i], apex_bot]).material_index = 0
    # Glowing sanctuary lock beacon medallion inside pocket
    add_cylinder_z(bm_lock, lx, ly, 0.0004, 0.0014, 0.023, 0.023, segments=28, mat_index=2)
    finalize_bmesh_object(
        "Multiball_Lock_Pocket",
        bm_lock,
        [mats["trim_chrome"], mats["trim_brass"], mats["lock_beacon"]],
        col,
        root,
    )


def build_tapered_flippers(
    root: bpy.types.Object,
    col: bpy.types.Collection,
    mats: dict[str, bpy.types.Material],
) -> None:
    """Build Flipper_Pivot_Left/Right empties and tapered Flipper_Blade_Left/Right bats."""
    flipper_configs = [
        ("Left", (FLIPPER_LEFT_X, FLIPPER_PIVOT_Y, 0.0), math.radians(-FLIPPER_REST_DEG), 1.0),
        ("Right", (FLIPPER_RIGHT_X, FLIPPER_PIVOT_Y, 0.0), math.radians(FLIPPER_REST_DEG), -1.0),
    ]

    for side_name, pivot_pos, rest_rot_z, dir_x in flipper_configs:
        pivot = bpy.data.objects.new(f"Flipper_Pivot_{side_name}", None)
        pivot.empty_display_type = "ARROWS"
        pivot.empty_display_size = 0.025
        pivot.location = pivot_pos
        pivot.rotation_mode = "XYZ"
        pivot.rotation_euler = (0.0, 0.0, rest_rot_z)
        link_object(pivot, col, root)

        # Tapered bat perimeter in XY: hub r=0.011 at (0,0), tip r=0.006 at (dir_x * 0.070, 0)
        # Total X reach from pivot center = 0.070 + 0.006 = 0.076 m!
        tip_x = dir_x * 0.070
        r_hub = 0.011
        r_tip = 0.006

        def bat_outline(extra_r: float) -> list[tuple[float, float]]:
            rh = r_hub + extra_r
            rt = r_tip + extra_r
            # Exact tangent angle between two circles along X
            sin_a = max(-0.99, min(0.99, (rh - rt) / 0.070))
            beta = math.asin(sin_a)
            pts: list[tuple[float, float]] = []
            # Hub arc (facing -dir_x)
            if dir_x > 0:
                a_hub_start = math.pi * 0.5 - beta
                a_hub_end = math.pi * 1.5 + beta
                a_tip_start = -math.pi * 0.5 + beta
                a_tip_end = math.pi * 0.5 - beta
            else:
                a_hub_start = -math.pi * 0.5 - beta
                a_hub_end = math.pi * 0.5 + beta
                a_tip_start = math.pi * 0.5 + beta
                a_tip_end = math.pi * 1.5 - beta

            n_arc = 16
            for i in range(n_arc + 1):
                a = a_hub_start + (a_hub_end - a_hub_start) * (i / n_arc)
                pts.append((rh * math.cos(a), rh * math.sin(a)))
            for i in range(n_arc + 1):
                a = a_tip_start + (a_tip_end - a_tip_start) * (i / n_arc)
                pts.append((tip_x + rt * math.cos(a), rt * math.sin(a)))
            return pts

        bm = bmesh.new()
        # Core ivory body (h = 0.024 m: z in [0.0005, 0.0245])
        add_extruded_polygon(bm, bat_outline(-0.0004), 0.0005, 0.0245, mat_index=0, smooth_sides=True)
        # Raised rubber bumper wrap around equator (z in [0.0035, 0.0205], proud by +0.0008 m)
        rubber_outer = bat_outline(0.0006)
        rubber_inner = bat_outline(-0.0010)
        n_o = len(rubber_outer)
        ro_b = [bm.verts.new((x, y, 0.0035)) for x, y in rubber_outer]
        ro_t = [bm.verts.new((x, y, 0.0205)) for x, y in rubber_outer]
        ri_b = [bm.verts.new((x, y, 0.0035)) for x, y in rubber_inner]
        ri_t = [bm.verts.new((x, y, 0.0205)) for x, y in rubber_inner]
        for i in range(n_o):
            j = (i + 1) % n_o
            f_side = bm.faces.new([ro_b[i], ro_b[j], ro_t[j], ro_t[i]])
            f_side.material_index = 1
            f_side.smooth = True
            bm.faces.new([ri_t[i], ro_t[i], ro_t[j], ri_t[j]]).material_index = 1
            bm.faces.new([ro_b[i], ri_b[i], ri_b[j], ro_b[j]]).material_index = 1

        # Brass hub shaft cap & decorative center rib on top
        add_cylinder_z(bm, 0.0, 0.0, 0.0240, 0.0258, 0.0065, 0.0055, segments=16, mat_index=2)
        add_rounded_segment_prism(bm, (0.0, 0.0), (tip_x * 0.88, 0.0), 0.0018, 0.0242, 0.0255, arc_segments=6, mat_index=2)

        finalize_bmesh_object(
            f"Flipper_Blade_{side_name}",
            bm,
            [mats["flipper_body"], mats["rubber"], mats["trim_brass"]],
            col,
            pivot,
            location=(0.0, 0.0, 0.0),
        )


# ---------------------------------------------------------------------------
# Export & Verification
# ---------------------------------------------------------------------------

def export_pinball_glb(col: bpy.types.Collection, output_path: Path) -> None:
    """Export only Pinball_Table collection to clean +Y Up GLB keeping pivots intact."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in col.all_objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_normals=True,
        export_materials="EXPORT",
    )


def verify_scene(col: bpy.types.Collection, glb_path: Path) -> None:
    """Assert every required node, pivot transform, and GLB size meets specification."""
    required_names = [
        "Pinball_Table_Root",
        "Cabinet_Wall_Left",
        "Cabinet_Wall_Right",
        "Cabinet_Wall_Front",
        "Cabinet_Wall_Rear",
        "Cabinet_Floor",
        "Cabinet_Rail_Left",
        "Cabinet_Rail_Right",
        "Cabinet_Lockdown_Bar",
        "Cabinet_Backbox_Arch",
        "Backglass_StainedGlass",
        "Playfield_Deck",
        "RoseWindow_Insert",
        "Plunger_Lane_Divider",
        "Plunger_Housing",
        "Plunger_Spring",
        "Plunger_Rod",
        "Upper_Orbit_Arch",
        "Rollover_Divider_1",
        "Rollover_Divider_2",
        "Rollover_Divider_3",
        "Rollover_Divider_4",
        "Bumper_Top",
        "Bumper_Top_Cap",
        "Bumper_Left",
        "Bumper_Left_Cap",
        "Bumper_Right",
        "Bumper_Right_Cap",
        "Slingshot_Left",
        "Slingshot_Right",
        "Apron_Guide_Left",
        "Apron_Guide_Right",
        "Drain_Guide_Left",
        "Drain_Guide_Right",
        "DropTarget_1",
        "DropTarget_2",
        "DropTarget_3",
        "Ramp_StainedGlass",
        "Multiball_Lock_Pocket",
        "Flipper_Pivot_Left",
        "Flipper_Blade_Left",
        "Flipper_Pivot_Right",
        "Flipper_Blade_Right",
    ]
    present = {obj.name: obj for obj in col.all_objects}
    missing = [name for name in required_names if name not in present]
    if missing:
        raise RuntimeError(f"Missing expected table objects: {missing}")

    root = present["Pinball_Table_Root"]
    assert abs(math.degrees(root.rotation_euler.x) - TILT_DEG) < 1e-4, "Root tilt mismatch"
    assert abs(root.location.z - ROOT_LIFT_Z) < 1e-4, "Root lift Z mismatch"

    f_left = present["Flipper_Pivot_Left"]
    f_right = present["Flipper_Pivot_Right"]
    assert abs(math.degrees(f_left.rotation_euler.z) - (-FLIPPER_REST_DEG)) < 1e-4
    assert abs(math.degrees(f_right.rotation_euler.z) - FLIPPER_REST_DEG) < 1e-4

    size_bytes = glb_path.stat().st_size if glb_path.exists() else 0
    if size_bytes <= 20_000:
        raise RuntimeError(f"Exported GLB too small: {size_bytes} bytes")

    print(
        f"[OK] Built {len(present)} objects under Pinball_Table_Root "
        f"(tilt={math.degrees(root.rotation_euler.x):.2f} deg, z={root.location.z:.5f} m) -> "
        f"{glb_path} ({size_bytes:,} bytes)"
    )


def render_qa_angles(output_dir: Path) -> None:
    """Render 4 multi-angle EEVEE material-shaded previews into companion docs folder."""
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_col = get_or_create_collection(PREVIEW_COLLECTION_NAME)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    # Configure rich dark cathedral ambient world + key/fill/rim lights
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Cathedral_World")
    if scene.world.node_tree is not None:
        bg = scene.world.node_tree.nodes.get("Background")
        if bg is not None:
            bg.inputs["Color"].default_value = (0.04, 0.055, 0.11, 1.0)
            bg.inputs["Strength"].default_value = 1.2

    def add_light(name: str, ltype: str, loc: tuple[float, float, float], energy: float, color: tuple[float, float, float], rot_deg: tuple[float, float, float]) -> None:
        ldata = bpy.data.lights.new(name=name, type=ltype)
        ldata.energy = energy
        ldata.color = color
        if ltype == "AREA":
            ldata.size = 0.8
        lobj = bpy.data.objects.new(name, ldata)
        lobj.location = loc
        lobj.rotation_euler = tuple(math.radians(a) for a in rot_deg)
        link_object(lobj, preview_col)

    add_light("Studio_Key", "AREA", (0.55, -0.65, 1.25), 95.0, (0.95, 0.96, 1.0), (28.0, 22.0, 0.0))
    add_light("Studio_Fill", "AREA", (-0.65, 0.30, 0.95), 45.0, (0.45, 0.65, 1.0), (-20.0, -35.0, 0.0))
    add_light("Studio_Rim", "SUN", (0.0, 0.0, 2.0), 2.5, (1.0, 0.88, 0.72), (35.0, -15.0, 45.0))

    cam_data = bpy.data.cameras.new("Studio_Camera")
    cam_data.lens = 38.0
    cam_obj = bpy.data.objects.new("Studio_Camera", cam_data)
    link_object(cam_obj, preview_col)
    scene.camera = cam_obj

    target = Vector((0.0, 0.04, 0.24))
    views = {
        "three_quarter": Vector((0.92, -1.24, 1.02)),
        "top": Vector((0.0, -0.02, 1.62)),
        "front": Vector((0.0, -1.42, 0.44)),
        "right": Vector((1.72, 0.04, 0.52)),
    }

    for view_name, cam_pos in views.items():
        cam_obj.location = cam_pos
        direction = (target - cam_pos).normalized()
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(output_dir / f"blender_qa_{view_name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[QA Render] Saved {scene.render.filepath}")


def build_pinball_table(*, render_qa: bool = False) -> None:
    """Build the entire cathedral pinball table, export GLB, and verify."""
    clear_existing_table()
    col = get_or_create_collection(COLLECTION_NAME)
    mats = create_material_palette()

    root = bpy.data.objects.new("Pinball_Table_Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.08
    root.location = (0.0, 0.0, ROOT_LIFT_Z)
    root.rotation_mode = "XYZ"
    root.rotation_euler = (TILT_RAD, 0.0, 0.0)
    link_object(root, col)

    build_cabinet(root, col, mats)
    build_playfield_and_rose_window(root, col, mats)
    build_plunger_assembly(root, col, mats)
    build_upper_arch_and_rollovers(root, col, mats)
    build_pop_bumpers(root, col, mats)
    build_slingshots_and_apron_guides(root, col, mats)
    build_drop_targets(root, col, mats)
    build_ramp_and_multiball_lock(root, col, mats)
    build_tapered_flippers(root, col, mats)

    bpy.context.view_layer.update()
    export_pinball_glb(col, GLB_OUTPUT_PATH)
    verify_scene(col, GLB_OUTPUT_PATH)

    if render_qa:
        render_qa_angles(DOK_OUTPUT_DIR)


if __name__ == "__main__":
    argv = sys.argv
    extra_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    build_pinball_table(render_qa=("--render-qa" in extra_args))
