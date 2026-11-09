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
    """Uneroded height for arrays of x, y: one tall peak with shoulders in rolling grassland."""
    r = np.hypot(x - PEAK.x, y - PEAK.y)
    peak = 6.4 * np.exp(-((r / 4.2) ** 1.3))
    shoulders = 1.8 * np.exp(-(((x - 3.6) ** 2 + (y + 0.4) ** 2) / 5)) + 1.5 * np.exp(
        -(((x + 4.0) ** 2 + (y - 1.6) ** 2) / 6)
    )
    pts = np.stack([x.ravel(), y.ravel()], -1)

    def field(fn):
        return np.array([fn(px, py) for px, py in pts]).reshape(x.shape)

    rough = field(
        lambda px, py: noise.ridged_multi_fractal(
            Vector((px * 0.35, py * 0.35, 3.0)), 0.9, 2.1, 7, 1.0, 2.0, noise_basis='PERLIN_NEW'
        )
    )
    rough = (rough - rough.mean()) / rough.std()
    hills = field(lambda px, py: noise.fractal(Vector((px * 0.07, py * 0.07, 7.0)), 1.0, 2.0, 5))
    mountain = peak + shoulders
    return mountain + rough * 0.35 * smooth(0.5, 4.0, mountain) + hills * 1.6


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
    h = erode(base(x, y))
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
    """Grass on gentle slopes, rock where it is steep or high, snow on high flat ground."""
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links.new
    out = node(nt, 'ShaderNodeOutputMaterial', (1400, 0))
    # grass and rock barely reflect; a normal sheen turns the far plains white at grazing angles
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (1100, 0), Roughness=1.0, **{'Specular IOR Level': 0.12})
    L(bsdf.outputs[0], out.inputs['Surface'])

    geo = node(nt, 'ShaderNodeNewGeometry', (-1200, 0))
    sep = node(nt, 'ShaderNodeSeparateXYZ', (-1000, 200))
    L(geo.outputs['Normal'], sep.inputs[0])
    pos = node(nt, 'ShaderNodeSeparateXYZ', (-1000, -100))
    L(geo.outputs['Position'], pos.inputs[0])
    # broken-up masks: noise shifts the rock line and snow line
    brk = node(nt, 'ShaderNodeTexNoise', (-1000, -400), Scale=1.6, Detail=8.0, Roughness=0.6)
    L(geo.outputs['Position'], brk.inputs['Vector'])

    def math_(op, a, b, loc):
        n = node(nt, 'ShaderNodeMath', loc, operation=op)
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    steep = math_('SUBTRACT', 1.0, sep.outputs['Z'], (-800, 200))  # 0 flat .. 1 vertical
    jitter = math_('MULTIPLY', math_('SUBTRACT', brk.outputs['Fac'], 0.5, (-800, -400)), 0.5, (-600, -400))
    rockmask_n = node(nt, 'ShaderNodeMapRange', (-400, 200), **{'From Min': 0.5, 'From Max': 0.66})
    L(math_('ADD', steep, jitter, (-600, 200)), rockmask_n.inputs['Value'])
    highrock = node(nt, 'ShaderNodeMapRange', (-400, 0), **{'From Min': 3.7, 'From Max': 4.5})
    L(math_('ADD', pos.outputs['Z'], math_('MULTIPLY', jitter, 6.0, (-600, -150)), (-600, 0)), highrock.inputs['Value'])
    rock = math_('MAXIMUM', rockmask_n.outputs[0], highrock.outputs[0], (-200, 100))
    snowh = node(nt, 'ShaderNodeMapRange', (-400, -250), **{'From Min': 4.8, 'From Max': 5.3})
    L(math_('ADD', pos.outputs['Z'], math_('MULTIPLY', jitter, 2.4, (-600, -300)), (-600, -250)), snowh.inputs['Value'])
    flat = node(nt, 'ShaderNodeMapRange', (-400, -450), **{'From Min': 0.38, 'From Max': 0.22})
    L(steep, flat.inputs['Value'])
    snow = math_('MULTIPLY', snowh.outputs[0], flat.outputs[0], (-200, -300))

    # grass: two greens and dry patches
    gn = node(nt, 'ShaderNodeTexNoise', (-400, 600), Scale=6.0, Detail=10.0)
    L(geo.outputs['Position'], gn.inputs['Vector'])
    grass = ramp(nt, (-200, 600), [(0.3, (0.05, 0.12, 0.025)), (0.55, (0.11, 0.2, 0.04)), (0.75, (0.2, 0.22, 0.08))])
    L(gn.outputs['Fac'], grass.inputs[0])
    # rock: dark stone with pale strata, like the reference
    strata = node(nt, 'ShaderNodeTexWave', (-600, 900), wave_type='BANDS', bands_direction='Z', Scale=1.1,
                  Distortion=14.0, Detail=8.0, **{'Detail Scale': 2.5})
    L(geo.outputs['Position'], strata.inputs['Vector'])
    rn = node(nt, 'ShaderNodeTexNoise', (-600, 1100), Scale=14.0, Detail=12.0, Roughness=0.7)
    L(geo.outputs['Position'], rn.inputs['Vector'])
    rockcol = ramp(nt, (-200, 950), [(0.2, (0.05, 0.045, 0.04)), (0.5, (0.16, 0.15, 0.13)), (0.8, (0.42, 0.4, 0.37))])
    L(math_('MULTIPLY', strata.outputs['Fac'], rn.outputs['Fac'], (-400, 950)), rockcol.inputs[0])

    mix1 = node(nt, 'ShaderNodeMix', (200, 400), data_type='RGBA')
    L(rock, live(mix1.inputs, 'Factor'))
    L(grass.outputs['Color'], live(mix1.inputs, 'A'))
    L(rockcol.outputs['Color'], live(mix1.inputs, 'B'))
    mix2 = node(nt, 'ShaderNodeMix', (450, 300), data_type='RGBA')
    L(snow, live(mix2.inputs, 'Factor'))
    L(live(mix1.outputs, 'Result'), live(mix2.inputs, 'A'))
    live(mix2.inputs, 'B').default_value = (0.85, 0.87, 0.9, 1.0)
    # crevices darker: ambient occlusion
    ao = node(nt, 'ShaderNodeAmbientOcclusion', (650, 300), Distance=0.6)
    L(live(mix2.outputs, 'Result'), ao.inputs['Color'])
    aomix = node(nt, 'ShaderNodeMix', (850, 300), data_type='RGBA', blend_type='MULTIPLY')
    live(aomix.inputs, 'Factor').default_value = 0.7
    L(live(mix2.outputs, 'Result'), live(aomix.inputs, 'A'))
    L(ao.outputs['AO'], live(aomix.inputs, 'B'))
    L(live(aomix.outputs, 'Result'), bsdf.inputs['Base Color'])

    # surface detail without extra geometry
    bn = node(nt, 'ShaderNodeTexNoise', (500, -300), Scale=60.0, Detail=12.0, Roughness=0.65)
    L(geo.outputs['Position'], bn.inputs['Vector'])
    bump = node(nt, 'ShaderNodeBump', (850, -300), Strength=0.35, Distance=0.02)
    L(math_('ADD', bn.outputs['Fac'], math_('MULTIPLY', rock, rn.outputs['Fac'], (650, -500)), (650, -300)), bump.inputs['Height'])
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
