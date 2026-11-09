"""The climb mountain for the home page, built and rendered in Blender (5.2+).

In Blender: Scripting tab, open this file, Run Script. It builds the scene so you can look around.
Render the stills headless from the repo root:

    blender -b -P blender/climb.py -- --render l      landscape, public/berg/l/000.webp ...
    blender -b -P blender/climb.py -- --render p      portrait,  public/berg/p/000.webp ...

Options: --samples 128, --scale 100 (percent of the full size), --only 0,55,119, --out <dir>.
The camera, path and stops follow src/scripts/frames.js and src/scripts/climb.js: COUNT frames,
frame i shows climb progress k = i / (COUNT - 1).
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector, noise

COUNT = 120
PEAK = Vector((0.0, 1.0))
SIZE = 64.0  # terrain width; the camera sees about the middle third
RES = 900  # vertices per side
SETS = {'l': (2560, 1440, 46), 'p': (1080, 2340, 60)}  # width, height, vertical field of view
ORANGE = (1.0, 0.478, 0.239)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------- terrain ----------


def base(x, y):
    """Uneroded height for arrays of x, y: one pointed peak with rock ridges, in smooth meadow."""
    dx, dy = x - PEAK.x, y - PEAK.y
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    peak = 7.2 * np.exp(-((r / 3.6) ** 1.05))  # nearly exponential: a sharp summit, wide skirt
    shoulders = 1.2 * np.exp(-(((x - 3.4) ** 2 + (y + 0.4) ** 2) / 4)) + 1.0 * np.exp(
        -(((x + 3.8) ** 2 + (y - 1.6) ** 2) / 5)
    )
    mountain = peak + shoulders
    pts = np.stack([x.ravel(), y.ravel()], -1)
    pol = np.stack([np.cos(th).ravel() * 2.4, np.sin(th).ravel() * 2.4, r.ravel() * 0.12], -1)

    def field(fn, coords):
        return np.array([fn(*c) for c in coords]).reshape(x.shape)

    # ridges running down from the summit, the spine of the rocky flanks
    ridge = field(
        lambda a, b, c: noise.ridged_multi_fractal(Vector((a, b, c)), 0.85, 2.0, 6, 1.0, 2.0, noise_basis='PERLIN_NEW'),
        pol,
    )
    ridge = (ridge - ridge.mean()) / ridge.std()
    rough = field(
        lambda px, py: noise.ridged_multi_fractal(
            Vector((px * 0.45, py * 0.45, 3.0)), 0.9, 2.1, 7, 1.0, 2.0, noise_basis='PERLIN_NEW'
        ),
        pts,
    )
    rough = (rough - rough.mean()) / rough.std()
    hills = field(lambda px, py: noise.fractal(Vector((px * 0.06, py * 0.06, 7.0)), 1.0, 2.0, 4), pts)
    flank = smooth(0.6, 3.0, mountain) * (1 - smooth(6.4, 7.2, mountain) * 0.5)
    return mountain + ridge * 0.45 * flank + rough * 0.1 * smooth(2.5, 5.0, mountain) + hills * 0.5


def base_meadow(x, y):
    """The meadow without the mountain, to tell the two apart."""
    return np.array(
        [noise.fractal(Vector((px * 0.06, py * 0.06, 7.0)), 1.0, 2.0, 4) for px, py in zip(x.ravel(), y.ravel())]
    ).reshape(x.shape) * 0.5


def erode(h, drops=900_000, batch=150_000, life=40, seed=4):
    """Hydraulic erosion with water droplets (after Hans Theobald Beyer's method): each drop
    runs downhill, picks up sediment where it speeds up and drops it where it slows down.
    That cuts the branching gullies and fans you see on real mountain flanks."""
    rng = np.random.default_rng(seed)
    n = h.shape[0]
    top = h.max()
    g = h / top  # work on 0..1 heights so the constants below are scale free
    inertia, capacity, min_slope, deposit, erosion, evaporate, gravity = 0.05, 4.0, 0.01, 0.3, 0.3, 0.02, 4.0

    def sample(px, py):
        ix, iy = px.astype(int), py.astype(int)
        fx, fy = px - ix, py - iy
        a, b, c, d = g[iy, ix], g[iy, ix + 1], g[iy + 1, ix], g[iy + 1, ix + 1]
        gx = (b - a) * (1 - fy) + (d - c) * fy
        gy = (c - a) * (1 - fx) + (d - b) * fx
        return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy, gx, gy, ix, iy, fx, fy

    def spread(ix, iy, fx, fy, amount):
        flat = g.ravel()
        for di, dj, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            np.add.at(flat, (iy + dj) * n + ix + di, amount * w)

    for done in range(0, drops, batch):
        px, py = rng.uniform(1, n - 2, batch), rng.uniform(1, n - 2, batch)
        dx, dy = np.zeros(batch), np.zeros(batch)
        speed, water, sed = np.ones(batch), np.ones(batch), np.zeros(batch)
        alive = np.ones(batch, bool)
        for _ in range(life):
            idx = np.flatnonzero(alive)
            if not len(idx):
                break
            hcur, gx, gy, ix, iy, fx, fy = sample(px[idx], py[idx])
            dx[idx] = dx[idx] * inertia - gx * (1 - inertia)
            dy[idx] = dy[idx] * inertia - gy * (1 - inertia)
            ln = np.hypot(dx[idx], dy[idx])
            still = ln == 0
            ln[still] = 1
            dx[idx] /= ln
            dy[idx] /= ln
            nx, ny = px[idx] + dx[idx], py[idx] + dy[idx]
            out = still | (nx < 1) | (nx >= n - 2) | (ny < 1) | (ny >= n - 2)
            nx, ny = np.clip(nx, 1, n - 2.001), np.clip(ny, 1, n - 2.001)
            hnew = sample(nx, ny)[0]
            dh = hnew - hcur
            cap = np.maximum(-dh, min_slope) * speed[idx] * water[idx] * capacity
            s = sed[idx]
            dep = np.where(dh > 0, np.minimum(dh, s), (s - cap) * deposit)
            dep = np.where((s > cap) | (dh > 0), dep, 0.0)
            ero = np.where((s <= cap) & (dh <= 0), np.minimum((cap - s) * erosion, -dh), 0.0)
            spread(ix, iy, fx, fy, dep - ero)
            sed[idx] = s - dep + ero
            speed[idx] = np.sqrt(np.maximum(speed[idx] ** 2 + dh * gravity, 0))
            water[idx] *= 1 - evaporate
            px[idx], py[idx] = nx, ny
            alive[idx[out]] = False
        # soften single-cell pits the droplets leave behind
        pad = np.pad(g, 1, mode='edge')
        avg = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) / 4
        g = g * 0.75 + avg * 0.25
        print(f'erosion {done + batch}/{drops} drops', end='\r')
    print()
    return g * top


TERRAIN = {}


def ground(x, y):
    """Height of the built terrain at x, y (bilinear), for things that sit on it."""
    g, lo, cell = TERRAIN['h'], -SIZE / 2, SIZE / (RES - 1)
    fx, fy = (np.asarray(x) - lo) / cell, (np.asarray(y) - lo) / cell
    i0, j0 = np.clip(np.floor(fx).astype(int), 0, RES - 2), np.clip(np.floor(fy).astype(int), 0, RES - 2)
    tx, ty = fx - i0, fy - j0
    return (
        g[j0, i0] * (1 - tx) * (1 - ty)
        + g[j0, i0 + 1] * tx * (1 - ty)
        + g[j0 + 1, i0] * (1 - tx) * ty
        + g[j0 + 1, i0 + 1] * tx * ty
    )


def build_terrain():
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=RES - 1, y_subdivisions=RES - 1, size=SIZE)
    ob = bpy.context.active_object
    ob.name = 'Terrain'
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    x, y = co[:, 0].reshape(RES, RES), co[:, 1].reshape(RES, RES)
    assert np.allclose(x[0], x[-1]) and np.allclose(y[:, 0], y[:, -1]), 'grid is not row-major in x'
    raw = base(x, y)
    # erode the mountain only; the meadow around it stays smooth
    h = raw + (erode(raw) - raw) * smooth(0.3, 1.4, raw - base_meadow(x, y))
    TERRAIN['h'] = h
    co[:, 2] = h.ravel()
    me.vertices.foreach_set('co', co.ravel())
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    mat = terrain_material()
    ob.data.materials.append(mat)

    # the land around it, out to the horizon: coarse and uneroded, just under the detailed part
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=499, y_subdivisions=499, size=SIZE * 7)
    far = bpy.context.active_object
    far.name = 'Land'
    fco = np.empty(len(far.data.vertices) * 3)
    far.data.vertices.foreach_get('co', fco)
    fco = fco.reshape(-1, 3)
    fco[:, 2] = base(fco[:, 0], fco[:, 1]) - 0.1
    far.data.vertices.foreach_set('co', fco.ravel())
    far.data.polygons.foreach_set('use_smooth', [True] * len(far.data.polygons))
    far.data.update()
    far.data.materials.append(mat)
    return ob


def node(nt, kind, loc, **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        if k in n.inputs:
            n.inputs[k].default_value = v
        else:
            setattr(n, k, v)
    return n


def live(sockets, name):
    # the Mix node has a socket per data type under the same name; take the one in use
    return next(s for s in sockets if s.name == name and s.enabled)


def ramp(nt, loc, stops):
    n = node(nt, 'ShaderNodeValToRGB', loc)
    els = n.color_ramp.elements
    els.remove(els[1])
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1.0)
    for pos, col in stops[1:]:
        els.new(pos).color = (*col, 1.0)
    return n


def terrain_material():
    """Meadow low down; brown rock taking over with height and steepness, grass holding on in
    the gullies; a dusting of snow on the very top."""
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links.new

    def math_(op, a, b, loc=(0, 0)):
        n = node(nt, 'ShaderNodeMath', loc, operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    def span(v, lo, hi, loc=(0, 0)):
        n = node(nt, 'ShaderNodeMapRange', loc, **{'From Min': lo, 'From Max': hi})
        L(v, n.inputs['Value'])
        return n.outputs[0]

    def tex(scale, detail=8.0, rough=0.6, loc=(0, 0)):
        n = node(nt, 'ShaderNodeTexNoise', loc, Scale=scale, Detail=detail, Roughness=rough)
        L(geo.outputs['Position'], n.inputs['Vector'])
        return n.outputs['Fac']

    def mix(fac, a, b, loc=(0, 0)):
        n = node(nt, 'ShaderNodeMix', loc, data_type='RGBA')
        L(fac, live(n.inputs, 'Factor'))
        for name, v in (('A', a), ('B', b)):
            if isinstance(v, tuple):
                live(n.inputs, name).default_value = (*v, 1.0)
            else:
                L(v, live(n.inputs, name))
        return live(n.outputs, 'Result')

    out = node(nt, 'ShaderNodeOutputMaterial', (1600, 0))
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (1300, 0), Roughness=0.95, **{'Specular IOR Level': 0.15})
    L(bsdf.outputs[0], out.inputs['Surface'])
    geo = node(nt, 'ShaderNodeNewGeometry', (-1400, 0))
    nz = node(nt, 'ShaderNodeSeparateXYZ', (-1200, 200))
    L(geo.outputs['Normal'], nz.inputs[0])
    pz = node(nt, 'ShaderNodeSeparateXYZ', (-1200, -100))
    L(geo.outputs['Position'], pz.inputs[0])

    steep = math_('SUBTRACT', 1.0, nz.outputs['Z'])  # 0 flat .. 1 vertical
    jitter = math_('SUBTRACT', tex(0.9, 6.0, 0.55), 0.5)
    # gullies are concave: grass and soil collect there
    gully = span(geo.outputs['Pointiness'], 0.52, 0.47)
    height = math_('ADD', pz.outputs['Z'], math_('MULTIPLY', jitter, 2.2))
    alpine = span(height, 0.8, 3.2)  # 0 in the meadow, 1 high on the mountain
    rockiness = math_('ADD', math_('MULTIPLY', steep, 1.3), math_('MULTIPLY', alpine, 0.55))
    rockiness = math_('SUBTRACT', rockiness, math_('MULTIPLY', gully, 0.6))
    rock = span(math_('ADD', rockiness, math_('MULTIPLY', jitter, 0.4)), 0.55, 0.75)
    snow = math_('MULTIPLY', span(height, 6.3, 6.9), span(steep, 0.45, 0.3))

    grass = ramp(nt, (0, 600), [(0.35, (0.055, 0.085, 0.022)), (0.55, (0.1, 0.14, 0.035)), (0.72, (0.17, 0.17, 0.06))])
    L(tex(2.2, 6.0, 0.5), grass.inputs[0])
    # higher grass is drier and browner
    grasscol = mix(math_('MULTIPLY', alpine, 0.6), grass.outputs['Color'], (0.16, 0.13, 0.06))
    grain = tex(9.0, 12.0, 0.7)
    # warm grey-brown stone with paler patches
    rockcol = ramp(nt, (0, 950), [(0.3, (0.07, 0.055, 0.045)), (0.55, (0.15, 0.12, 0.09)), (0.8, (0.24, 0.21, 0.17)), (0.95, (0.42, 0.4, 0.36))])
    L(grain, rockcol.inputs[0])

    col = mix(rock, grasscol, rockcol.outputs['Color'])
    col = mix(snow, col, (0.8, 0.82, 0.85))
    ao = node(nt, 'ShaderNodeAmbientOcclusion', (900, 300), Distance=0.8)
    L(col, ao.inputs['Color'])
    shaded = node(nt, 'ShaderNodeMix', (1100, 300), data_type='RGBA', blend_type='MULTIPLY')
    live(shaded.inputs, 'Factor').default_value = 0.6
    L(col, live(shaded.inputs, 'A'))
    L(ao.outputs['AO'], live(shaded.inputs, 'B'))
    L(live(shaded.outputs, 'Result'), bsdf.inputs['Base Color'])

    # fine relief: craggy on rock, soft on grass
    crag = node(nt, 'ShaderNodeTexNoise', (600, -500), noise_type='RIDGED_MULTIFRACTAL', Scale=5.0, Detail=10.0,
                Roughness=0.6, Lacunarity=2.2)
    L(geo.outputs['Position'], crag.inputs['Vector'])
    relief = math_('ADD', math_('MULTIPLY', tex(40.0, 10.0, 0.6), 0.25), math_('MULTIPLY', rock, crag.outputs['Fac']))
    bump = node(nt, 'ShaderNodeBump', (1100, -300), Strength=0.35, Distance=0.06)
    L(relief, bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# ---------- path, climber and stops ----------


def path_points():
    """The spiral from the valley to the summit, same shape as the 3D scene in mountain.js."""
    t = np.linspace(0, 1, 600)
    a = -2.55 + t * 3.4
    rad = 7.2 * (1 - t) ** 1.1 + 0.05
    # three.js x/z -> Blender x/-y; the peak sits at three z = -1, Blender y = 1
    x = PEAK.x + np.cos(a) * rad
    y = PEAK.y - np.sin(a) * rad
    z = ground(x, y) + 0.07
    return np.stack([x, y, z], -1)


def at_length(pts, k):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    s = k * cum[-1]
    i = min(np.searchsorted(cum, s, side='right') - 1, len(seg) - 1)
    f = (s - cum[i]) / seg[i]
    return Vector(pts[i] + (pts[i + 1] - pts[i]) * f)


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, 'ShaderNodeOutputMaterial', (300, 0))
    em = node(nt, 'ShaderNodeEmission', (100, 0), Strength=strength)
    info = node(nt, 'ShaderNodeObjectInfo', (-100, 0))
    nt.links.new(info.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def step_at(k):
    return 0 if k < 0.06 else min(5, 1 + math.floor(((k - 0.06) / 0.94) * 5 * 0.999))


def build_path(pts):
    cu = bpy.data.curves.new('Path', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    sp.points.foreach_set('co', np.hstack([pts, np.ones((len(pts), 1))]).ravel())
    cu.bevel_depth = 0.035
    cu.bevel_resolution = 4
    cu.bevel_factor_mapping_end = 'SPLINE'
    ob = bpy.data.objects.new('Path', cu)
    ob.color = (*ORANGE, 1)
    cu.materials.append(emission('Glow', ORANGE, 2.0))
    bpy.context.scene.collection.objects.link(ob)

    glow = bpy.data.materials['Glow']
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, segments=32, ring_count=16)
    me = bpy.context.active_object
    me.name = 'Climber'
    me.color = (*ORANGE, 1)
    me.data.materials.append(glow)
    me.data.polygons.foreach_set('use_smooth', [True] * len(me.data.polygons))

    marks = []
    for i in range(1, 6):
        k = 0.06 + (i - 1) * 0.188 if i < 5 else 0.999
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, segments=24, ring_count=12, location=at_length(pts, k) + Vector((0, 0, 0.06)))
        mk = bpy.context.active_object
        mk.name = f'Stop {i}'
        mk.data.materials.append(glow)
        mk.data.polygons.foreach_set('use_smooth', [True] * len(mk.data.polygons))
        marks.append(mk)

    edit = bpy.context.preferences.edit
    for f in range(COUNT):
        k = f / (COUNT - 1)
        edit.keyframe_new_interpolation_type = 'LINEAR'
        cu.bevel_factor_end = k
        cu.keyframe_insert('bevel_factor_end', frame=f)
        me.location = at_length(pts, min(0.999, k))
        me.keyframe_insert('location', frame=f)
        # the stop markers jump from one state to the next
        edit.keyframe_new_interpolation_type = 'CONSTANT'
        now = step_at(k)
        for i, mk in enumerate(marks, 1):
            mk.scale = [2.6 if i == now else 1.3 if i < now else 1.0] * 3
            mk.color = (*ORANGE, 1) if i <= now else (1, 1, 1, 1)
            mk.keyframe_insert('scale', frame=f)
            mk.keyframe_insert('color', frame=f)


# ---------- camera, sun and sky ----------


def camera_at(k, portrait):
    """Same orbit as mountain.js: swing round the peak while rising, from dawn to morning."""
    ca = -2.3 + k * 3.4
    cd = (15 - k * 3.5) * (1.45 if portrait else 1)
    pos = Vector((PEAK.x + math.cos(ca) * cd, PEAK.y - math.sin(ca) * cd, 6.4 + k * 3.6 + (2.5 if portrait else 0)))
    look = Vector((PEAK.x, PEAK.y, 1.4 + k * 2.6))
    return pos, look


def build_camera_and_light(set_):
    w, h, fov = SETS[set_]
    portrait = set_ == 'p'
    sc = bpy.context.scene
    cam = bpy.data.objects.get('Camera') or bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(fov)
    cam.data.clip_end = 400
    sc.render.resolution_x, sc.render.resolution_y = w, h

    sun = bpy.data.objects.get('Sun') or bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    if sun.name not in sc.collection.objects:
        sc.collection.objects.link(sun)
    sun.data.angle = math.radians(1.2)

    world = sc.world or bpy.data.worlds.new('World')
    sc.world = world
    nt = world.node_tree
    nt.nodes.clear()
    sky = node(nt, 'ShaderNodeTexSky', (-300, 0), sky_type='MULTIPLE_SCATTERING', sun_disc=True, sun_size=math.radians(2.5))
    # the sky lights the land softly but is seen brighter, so open ground keeps its colour
    bg = node(nt, 'ShaderNodeBackground', (0, 0), Strength=0.1)
    seen = node(nt, 'ShaderNodeBackground', (0, -150), Strength=0.3)
    ray = node(nt, 'ShaderNodeLightPath', (-300, 300))
    pick = node(nt, 'ShaderNodeMixShader', (200, 0))
    out = node(nt, 'ShaderNodeOutputWorld', (400, 0))
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(sky.outputs[0], seen.inputs[0])
    nt.links.new(ray.outputs['Is Camera Ray'], pick.inputs[0])
    nt.links.new(bg.outputs[0], pick.inputs[1])
    nt.links.new(seen.outputs[0], pick.inputs[2])
    nt.links.new(pick.outputs[0], out.inputs[0])
    # thin haze in a box over the land (a world volume would also swallow the sun): far land
    # fades into the sky, like a real valley
    if 'Haze' not in bpy.data.objects:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 18))
        box = bpy.context.active_object
        box.name = 'Haze'
        box.scale = (SIZE * 6, SIZE * 6, 40)
        hm = bpy.data.materials.new('Haze')
        hm.use_nodes = True
        ht = hm.node_tree
        ht.nodes.clear()
        vol = node(ht, 'ShaderNodeVolumePrincipled', (0, 0), Density=0.0025, Anisotropy=0.4, Color=(0.75, 0.82, 0.95, 1))
        hout = node(ht, 'ShaderNodeOutputMaterial', (250, 0))
        ht.links.new(vol.outputs[0], hout.inputs['Volume'])
        box.data.materials.append(hm)

    for f in range(COUNT):
        k = f / (COUNT - 1)
        pos, look = camera_at(k, portrait)
        cam.location = pos
        cam.rotation_euler = (look - pos).to_track_quat('-Z', 'Y').to_euler()
        cam.keyframe_insert('location', frame=f)
        cam.keyframe_insert('rotation_euler', frame=f)
        # sun low and to the side of the view so the gullies cast shadows; it rises with the climb
        d = Vector((PEAK.x - pos.x, PEAK.y - pos.y, 0)).normalized()
        side = Vector((-d.y, d.x, 0))
        aim = d * 12 + side * 30
        az = math.atan2(aim.y, aim.x)
        el = math.radians(1.0 + k * 34)
        sky.sun_elevation = el
        sky.sun_rotation = (math.pi / 2 - az) % (2 * math.pi)
        sky.keyframe_insert('sun_elevation', frame=f)
        sky.keyframe_insert('sun_rotation', frame=f)
        toward = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sun.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()
        sun.data.energy = 1.2 + k * 2.4
        bg.inputs['Strength'].default_value = 0.3 - k * 0.2
        bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
        sun.keyframe_insert('rotation_euler', frame=f)
        sun.data.keyframe_insert('energy', frame=f)


def setup_render(samples, scale):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_percentage = scale
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.quality = 80
    sc.frame_start, sc.frame_end = 0, COUNT - 1
    sc.view_settings.view_transform = 'AgX'
    for look in ('AgX - Medium High Contrast', 'Medium High Contrast'):
        try:
            sc.view_settings.look = look
            break
        except TypeError:
            pass
    # use the GPU when Blender has one configured
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                sc.cycles.device = 'GPU'
                print('Rendering on', kind)
                break
        except (TypeError, RuntimeError):
            continue


def build():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    build_terrain()
    build_path(path_points())


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    opt = {argv[i].lstrip('-'): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
    set_ = opt.get('render', 'l')
    import addon_utils

    addon_utils.enable('cycles')
    build()
    build_camera_and_light(set_)
    setup_render(int(opt.get('samples', 128)), int(opt.get('scale', 100)))
    sc = bpy.context.scene
    sc.frame_set(0)
    if 'render' not in opt:
        return
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = opt.get('out', os.path.join(root, 'public', 'berg', set_))
    os.makedirs(out, exist_ok=True)
    frames = [int(f) for f in opt['only'].split(',')] if 'only' in opt else range(COUNT)
    for f in frames:
        sc.frame_set(f)
        sc.render.filepath = os.path.join(out, f'{f:03d}')
        bpy.ops.render.render(write_still=True)


main()
