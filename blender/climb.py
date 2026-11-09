"""The climb mountain for the home page, built and rendered in Blender (5.2+).

In Blender: Scripting tab, open this file, Run Script. It builds the scene so you can look around.
Render the stills headless from the repo root:

    blender -b -P blender/climb.py -- --render l      landscape, public/berg/l/000.webp ...
    blender -b -P blender/climb.py -- --render p      portrait,  public/berg/p/000.webp ...

Options: --samples 128, --scale 100 (percent of the full size), --only 0,55,119, --out <dir>,
--res 1600 (terrain vertices per side), --save <file.blend> to keep the built scene.
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
SIZE = 48.0  # width of the detailed terrain; coarser land runs on from it to the horizon
FULL = 1600
# vertices per side: all of them for a render, a light scene to look around in the Blender window
RES = FULL if bpy.app.background else 560
SETS = {'l': (2560, 1440, 46), 'p': (1080, 2340, 60)}  # width, height, vertical field of view
ORANGE = (1.0, 0.478, 0.239)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a, r, passes=2):
    """Box blur of a 2D array over 2r+1 cells, run twice so it falls off softly."""
    for _ in range(passes):
        for ax in (0, 1):
            p = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in (0, 1)], mode='edge'), axis=ax)
            hi = [slice(2 * r + 1, None) if i == ax else slice(None) for i in (0, 1)]
            lo = [slice(None, -(2 * r + 1)) if i == ax else slice(None) for i in (0, 1)]
            a = (p[tuple(hi)] - p[tuple(lo)]) / (2 * r + 1)
    return a


assert np.allclose(blur(np.full((9, 7), 3.0), 2), 3.0) and blur(np.eye(9), 1).shape == (9, 9)


# ---------- terrain ----------


def base(x, y):
    """Uneroded height for arrays of x, y: one pointed peak with rock ridges, in smooth meadow."""
    dx, dy = x - PEAK.x, y - PEAK.y
    r = np.hypot(dx, dy)
    # bend the directions a little so the ridges wander instead of running dead straight
    warp = np.array([noise.noise(Vector((px * 0.22, py * 0.22, 1.5))) for px, py in zip(x.ravel(), y.ravel())])
    th = np.arctan2(dy, dx) + 0.45 * warp.reshape(x.shape)
    # a horn: three sharp aretes with hollow faces between them, and a summit that is a point,
    # not a single needle vertex
    arete = np.abs(np.cos(1.5 * (th - 0.7))) ** 3
    spread = 1 + (0.22 - 0.38 * arete) * smooth(0.0, 0.9, r)
    d = np.sqrt(r * r + 0.06) * spread
    # a broad cone carrying a steeper horn: gentler flanks, and a top third that reads as a summit
    peak = 5.6 * np.exp(-d / 3.8) + 1.6 * np.exp(-((d / 1.3) ** 1.5))
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
    # the ridges fade out towards the summit, where the polar noise would bunch up into ledges
    flank = smooth(0.6, 2.6, mountain) * (1 - smooth(4.4, 6.0, mountain) * 0.85) * smooth(0.1, 0.8, r)
    h = mountain + ridge * 0.45 * flank + rough * 0.1 * smooth(2.0, 4.0, mountain) * (1 - smooth(4.8, 6.0, mountain)) + hills * 0.5
    if r.max() > 40:
        # far ranges that fade into the haze on the horizon
        far = field(lambda px, py: noise.fractal(Vector((px * 0.011, py * 0.011, 2.0)), 1.0, 2.0, 5), pts)
        h += smooth(40, 130, r) * 16 * np.maximum(far + 0.15, 0)
    return h


def base_meadow(x, y):
    """The meadow without the mountain, to tell the two apart."""
    return np.array(
        [noise.fractal(Vector((px * 0.06, py * 0.06, 7.0)), 1.0, 2.0, 4) for px, py in zip(x.ravel(), y.ravel())]
    ).reshape(x.shape) * 0.5


def erode(h, rad, drops, life, seed=4):
    """Hydraulic erosion with water droplets (after Hans Theobald Beyer's method): each drop
    runs downhill, picks up sediment where it speeds up and drops it where it slows down.
    That cuts the branching gullies and fans you see on real mountain flanks. h is square with
    the mountain in the middle; the rain falls within rad cells of the centre."""
    rng = np.random.default_rng(seed)
    n = h.shape[0]
    top = h.max()
    g = h / top  # work on 0..1 heights so the constants below are scale free
    inertia, capacity, min_slope, deposit, erosion, evaporate, gravity = 0.1, 4.0, 0.01, 0.3, 0.3, 0.015, 4.0

    def sample(px, py):
        ix, iy = px.astype(int), py.astype(int)
        fx, fy = px - ix, py - iy
        a, b, c, d = g[iy, ix], g[iy, ix + 1], g[iy + 1, ix], g[iy + 1, ix + 1]
        gx = (b - a) * (1 - fy) + (d - c) * fy
        gy = (c - a) * (1 - fx) + (d - b) * fx
        return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy, gx, gy, ix, iy, fx, fy

    def spread(ix, iy, fx, fy, amount):
        cell = iy * n + ix
        at = np.concatenate([cell, cell + 1, cell + n, cell + n + 1])
        w = np.concatenate([amount * (1 - fx) * (1 - fy), amount * fx * (1 - fy), amount * (1 - fx) * fy, amount * fx * fy])
        return np.bincount(at, w, n * n).reshape(n, n)

    # drops in one batch do not see each other dig: keep them sparse or they overshoot together
    batch = int(0.05 * np.pi * rad * rad)
    for done in range(0, drops, batch):
        before = g.copy()
        ang, far = rng.uniform(0, 2 * np.pi, batch), rad * np.sqrt(rng.uniform(0, 1, batch))
        px, py = n / 2 + np.cos(ang) * far, n / 2 + np.sin(ang) * far
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
            g += spread(ix, iy, fx, fy, dep - ero)
            sed[idx] = s - dep + ero
            speed[idx] = np.sqrt(np.maximum(speed[idx] ** 2 + dh * gravity, 0))
            water[idx] *= 1 - evaporate
            px[idx], py[idx] = nx, ny
            alive[idx[out]] = False
        # a drop wears an area, not one cell: spread what this batch did over the neighbours, so
        # the gullies come out free of pits while the ridges between them stay crisp
        g = before + blur(g - before, 1)
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
    above = raw - base_meadow(x, y)  # height over the meadow: where the mountain is
    cell = SIZE / (RES - 1)
    cell_of = lambda v: np.round((np.asarray(v) + SIZE / 2) / cell).astype(int)
    cells = lambda units: max(1, round(units / cell))
    # erode the mountain only, in a window around it; the meadow stays smooth
    ci, cj, w = cell_of(PEAK.x), cell_of(PEAK.y), cells(12)
    win = np.s_[cj - w : cj + w, ci - w : ci + w]
    cut = raw.copy()
    cut[win] = erode(raw[win], cells(9), drops=int(350_000 * (RES / FULL) ** 2), life=int(140 * RES / FULL))
    # the water may carve and pile up only so far, so the mountain keeps its shape
    h = raw + 0.6 * np.tanh((cut - raw) / 0.6) * smooth(0.5, 1.6, above)
    # at the foot the last of the gullies melt into the meadow, so the grass has no dents
    h += (blur(h, cells(0.3)) - h) * (1 - smooth(1.2, 2.6, above))
    # and no pits on the lower slopes: nothing there may lie far below the ground around it
    h += np.maximum(blur(h, cells(0.25)) - 0.04 - h, 0) * (1 - smooth(2.2, 3.4, above))
    # the drops leave lone cells standing as spikes along the ridges: let nothing stick out, or
    # in, more than a hand's width from the ground right around it, then take the last edge off
    around = blur(h, cells(0.12))
    h = around + 0.12 * np.tanh((h - around) / 0.12)
    h = blur(h, 1, 1)
    # round off the last few vertices of the summit so it ends in a clean point, not a stump
    h += (blur(h, cells(0.06)) - h) * (1 - smooth(0.1, 0.5, np.hypot(x - PEAK.x, y - PEAK.y)))
    # a trail: even out the ground under the path so the line is not lost between the crags
    px, py = path_xy()
    near = np.zeros_like(h)
    near[cell_of(py), cell_of(px)] = 1
    near = blur(near, cells(0.15))
    near = smooth(0.15, 0.7, near / near.max())
    h += (blur(h, cells(0.12)) - h) * near
    assert np.abs(h - raw).max() < 3, 'the erosion ran away'
    TERRAIN['h'] = h
    co[:, 2] = h.ravel()
    me.vertices.foreach_set('co', co.ravel())
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()

    # what the material and the detail modifier need to know about each vertex
    gy, gx = np.gradient(h, cell)
    steep = 1 - 1 / np.sqrt(1 + gx * gx + gy * gy)  # 0 flat .. 1 vertical
    wear = h - raw  # below 0 where water cut a gully, above 0 where it left a fan of debris
    masks = {
        'hollow': blur(h, cells(0.18)) - h,
        'wear': wear,
        # none on the summit: the snow there wants one clean face, not steps
        'crag': smooth(0.2, 0.45, steep) * smooth(1.0, 2.2, above) * (1 - near) * (1 - smooth(4.5, 5.3, h)),
        'turf': (1 - smooth(0.2, 0.4, steep)) * (1 - smooth(1.2, 2.4, above)) * (1 - smooth(5, 22, np.hypot(x - PEAK.x, y - PEAK.y))) * (1 - near),
        'scree': (smooth(0.01, 0.06, wear) * smooth(0.6, 1.6, above) + 0.02 * smooth(0.2, 0.8, above)) * (1 - near) * (1 - smooth(4.0, 4.6, h)),
    }
    for name, a in masks.items():
        me.attributes.new(name, 'FLOAT', 'POINT').data.foreach_set('value', a.ravel())
    mat = terrain_material()
    ob.data.materials.append(mat)
    detail_modifier(ob, build_rock(), build_tuft())

    # the land around it, out to the horizon: coarse and uneroded, just under the detailed part
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=499, y_subdivisions=499, size=448)
    far = bpy.context.active_object
    far.name = 'Land'
    fco = np.empty(len(far.data.vertices) * 3)
    far.data.vertices.foreach_get('co', fco)
    fco = fco.reshape(-1, 3)
    # it dips well below the detailed part, or it would show through the eroded gullies
    inside = 1 - smooth(SIZE / 2 - 4, SIZE / 2 - 1, np.maximum(np.abs(fco[:, 0]), np.abs(fco[:, 1])))
    fco[:, 2] = base(fco[:, 0], fco[:, 1]) - 0.1 - 6 * inside
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


def calc(nt, op, a, b=0.0):
    """A Math node; a and b are numbers or sockets. Works in shader and geometry node trees."""
    n = node(nt, 'ShaderNodeMath', (0, 0), operation=op)
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def remap(nt, v, lo, hi, to=(0.0, 1.0)):
    n = node(nt, 'ShaderNodeMapRange', (0, 0), **{'From Min': lo, 'From Max': hi, 'To Min': to[0], 'To Max': to[1]})
    nt.links.new(v, n.inputs['Value'])
    return n.outputs[0]


GRASS = [(0.3, (0.028, 0.062, 0.012)), (0.5, (0.05, 0.1, 0.018)), (0.7, (0.088, 0.128, 0.028))]
ROCK = [(0.3, (0.06, 0.043, 0.032)), (0.5, (0.115, 0.083, 0.058)), (0.68, (0.165, 0.135, 0.105)), (0.9, (0.24, 0.215, 0.185))]


def terrain_material():
    """Meadow low down; brown rock taking over with height and steepness, grass holding on in
    the gullies; fans of scree where the water left its debris; snow on the very top."""
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links.new

    def math_(op, a, b):
        return calc(nt, op, a, b)

    def span(v, lo, hi, to=(0.0, 1.0)):
        return remap(nt, v, lo, hi, to)

    def total(*terms):
        acc = None
        for v, w in terms:
            t = math_('MULTIPLY', v, w)
            acc = t if acc is None else math_('ADD', acc, t)
        return acc

    def attr(name):
        return node(nt, 'ShaderNodeAttribute', (-1400, -400), attribute_name=name).outputs[2]

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

    hollow, wear = attr('hollow'), attr('wear')
    steep = math_('SUBTRACT', 1.0, nz.outputs['Z'])  # 0 flat .. 1 vertical
    jitter = math_('SUBTRACT', tex(0.9, 6.0, 0.55), 0.5)
    # gullies are hollow: grass and soil collect there
    gully = span(hollow, 0.02, 0.1)
    height = math_('ADD', pz.outputs['Z'], math_('MULTIPLY', jitter, 1.2))
    alpine = span(height, 1.0, 3.2)  # 0 in the meadow, 1 from the middle of the mountain up
    high = span(height, 3.2, 5.0)  # up here not even the gullies stay green
    rock = span(total((steep, 1.1), (alpine, 0.4), (high, 0.5), (jitter, 0.3), (gully, -0.7)), 0.6, 0.8)
    scree = math_('MULTIPLY', span(wear, 0.02, 0.08), alpine)
    snow = math_('MULTIPLY', span(total((height, 1.0), (hollow, 2.0)), 4.9, 5.6), span(steep, 0.62, 0.42))

    def voronoi(scale):
        n = node(nt, 'ShaderNodeTexVoronoi', (0, 0), feature='DISTANCE_TO_EDGE', Scale=scale)
        L(geo.outputs['Position'], n.inputs['Vector'])
        return n.outputs['Distance']

    # grass: broad patches of lush and paler green, drier yellow spots, damp dark hollows, a fine
    # speckle so it reads as turf, and low on the slopes a little heather
    grass = ramp(nt, (0, 600), GRASS)
    L(tex(0.35, 5.0, 0.55), grass.inputs[0])
    grasscol = mix(span(tex(2.5, 4.0, 0.5), 0.52, 0.8, (0.0, 0.55)), grass.outputs['Color'], (0.15, 0.14, 0.045))
    grasscol = mix(span(hollow, 0.01, 0.08, (0.0, 0.6)), grasscol, (0.025, 0.05, 0.016))
    heather = math_('MULTIPLY', span(tex(1.3, 4.0, 0.6), 0.6, 0.72), span(height, 0.5, 1.4, (0.0, 0.5)))
    grasscol = mix(heather, grasscol, (0.1, 0.055, 0.07))
    grasscol = mix(span(tex(34.0, 3.0, 0.5), 0.35, 0.7, (0.0, 0.3)), grasscol, (0.03, 0.05, 0.014))
    # higher grass is drier and browner
    grasscol = mix(math_('MULTIPLY', alpine, 0.7), grasscol, (0.15, 0.105, 0.05))

    # stone: warm grey-brown in large patches with ochre stains, crossed by darker beds that lie
    # almost level, cracked into blocks, dark where the water runs and pale on the exposed edges
    rockcol = ramp(nt, (0, 950), ROCK)
    L(tex(0.45, 5.0, 0.55), rockcol.inputs[0])
    stone = mix(span(tex(1.4, 4.0, 0.55), 0.52, 0.75, (0.0, 0.5)), rockcol.outputs['Color'], (0.2, 0.115, 0.055))
    lay = node(nt, 'ShaderNodeMapping', (-600, 900))
    lay.inputs['Scale'].default_value = (0.5, 0.5, 7.0)
    L(geo.outputs['Position'], lay.inputs['Vector'])
    beds = node(nt, 'ShaderNodeTexNoise', (-400, 900), Scale=1.0, Detail=3.0, Roughness=0.5)
    L(lay.outputs[0], beds.inputs['Vector'])
    stone = mix(span(beds.outputs[0], 0.45, 0.75, (0.0, 0.45)), stone, (0.04, 0.032, 0.026))
    stone = mix(span(beds.outputs[0], 0.4, 0.2, (0.0, 0.25)), stone, (0.3, 0.26, 0.2))
    # joints show here and there, not as a net over the whole wall
    cracks = math_('MULTIPLY', span(voronoi(5.0), 0.0, 0.035, (1.0, 0.0)), span(tex(2.0, 3.0, 0.5), 0.45, 0.65))
    stone = mix(math_('MULTIPLY', cracks, 0.3), stone, (0.03, 0.024, 0.02))
    stone = mix(span(wear, -0.05, -0.4, (0.0, 0.45)), stone, (0.035, 0.028, 0.022))
    stone = mix(span(hollow, 0.0, -0.12, (0.0, 0.25)), stone, (0.38, 0.33, 0.27))
    # lichen and moss creep onto the lower rock
    lichen = math_('MULTIPLY', span(tex(5.0, 4.0, 0.6), 0.5, 0.7), span(height, 3.6, 1.6, (0.0, 0.55)))
    stone = mix(lichen, stone, (0.085, 0.095, 0.04))

    col = mix(rock, grasscol, stone)
    # between grass and rock lies bare earth, not a clean line
    edge = math_('MULTIPLY', span(rock, 0.0, 0.5), span(rock, 1.0, 0.5))
    col = mix(math_('MULTIPLY', edge, 0.75), col, (0.085, 0.058, 0.034))
    col = mix(math_('MULTIPLY', scree, 0.8), col, (0.17, 0.135, 0.1))
    # hollows sit in shade
    col = mix(span(hollow, 0.0, 0.2, (0.0, 0.55)), col, (0.01, 0.01, 0.008))
    col = mix(snow, col, (0.8, 0.82, 0.85))
    L(col, bsdf.inputs['Base Color'])
    L(mix(snow, mix(rock, (0.95,) * 3, span(tex(3.0, 3.0, 0.5), 0.3, 0.7, (0.75, 0.92))), (0.5,) * 3), bsdf.inputs['Roughness'])
    # grass catches low light with a soft glow along its edges
    L(span(total((rock, 1.0), (snow, 1.0)), 0.0, 1.0, (0.06, 0.0)), bsdf.inputs['Sheen Weight'])
    bsdf.inputs['Sheen Tint'].default_value = (0.75, 0.9, 0.5, 1.0)

    # fine relief: blocks and grain on the rock, soft tufts on the grass
    crag = node(nt, 'ShaderNodeTexNoise', (600, -500), noise_type='RIDGED_MULTIFRACTAL', Scale=3.5, Detail=4.0,
                Roughness=0.55, Lacunarity=2.2)
    L(geo.outputs['Position'], crag.inputs['Vector'])
    stony = total((crag.outputs[0], 0.8), (cracks, -0.3), (tex(28.0, 3.0, 0.5), 0.2))
    turf = total((tex(9.0, 4.0, 0.55), 0.12), (tex(45.0, 2.0, 0.5), 0.05))
    relief = math_('ADD', math_('MULTIPLY', rock, stony), math_('MULTIPLY', math_('SUBTRACT', 1.0, rock), turf))
    bump = node(nt, 'ShaderNodeBump', (1100, -300), Strength=0.35, Distance=0.05)
    L(relief, bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def build_rock():
    """One lumpy boulder; the detail modifier strews copies of it over the scree."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1)
    ob = bpy.context.active_object
    ob.name = 'Rock'
    for v in ob.data.vertices:
        v.co *= 1 + 0.45 * noise.noise(v.co * 1.1)
        v.co.z *= 0.65
    ob.hide_render = ob.hide_viewport = True
    m = bpy.data.materials.new('Boulder')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, 'ShaderNodeOutputMaterial', (600, 0))
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (300, 0), Roughness=0.9, **{'Specular IOR Level': 0.15})
    shade = ramp(nt, (0, 0), ROCK)
    nt.links.new(remap(nt, node(nt, 'ShaderNodeObjectInfo', (-200, 0)).outputs['Random'], 0.0, 1.0, (0.25, 0.7)), shade.inputs[0])
    nt.links.new(shade.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    ob.data.materials.append(m)
    return ob


def build_tuft():
    """A tuft of grass: a handful of blades leaning out from one root."""
    verts, faces = [], []
    for i in range(7):
        a = i * 2.4  # golden angle, so the blades spread evenly
        out, side = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
        lean = 0.25 + 0.3 * (i % 3) / 2
        verts += [out * 0.1 - side * 0.14, out * 0.1 + side * 0.14, out * (0.1 + lean) + Vector((0, 0, 1.0 - 0.3 * lean))]
        faces.append((3 * i, 3 * i + 1, 3 * i + 2))
    me = bpy.data.meshes.new('Tuft')
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new('Tuft', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.hide_render = ob.hide_viewport = True
    m = bpy.data.materials.new('Tuft')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, 'ShaderNodeOutputMaterial', (600, 0))
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (300, 0), Roughness=0.8, **{'Specular IOR Level': 0.2})
    # the same patches of colour as the ground it stands on, each tuft a little lighter or darker
    patch = node(nt, 'ShaderNodeTexNoise', (-400, 0), Scale=0.35, Detail=5.0, Roughness=0.55)
    nt.links.new(node(nt, 'ShaderNodeNewGeometry', (-600, 0)).outputs['Position'], patch.inputs['Vector'])
    shade = ramp(nt, (0, 0), GRASS)
    nt.links.new(calc(nt, 'ADD', patch.outputs[0], remap(nt, node(nt, 'ShaderNodeObjectInfo', (-400, -300)).outputs['Random'], 0.0, 1.0, (0.1, 0.4))), shade.inputs[0])
    nt.links.new(shade.outputs['Color'], bsdf.inputs['Base Color'])
    # blades let the light through: lit from behind they glow instead of going black
    thin = node(nt, 'ShaderNodeBsdfTranslucent', (300, -300))
    nt.links.new(shade.outputs['Color'], thin.inputs['Color'])
    both = node(nt, 'ShaderNodeMixShader', (500, 0), Fac=0.5)
    nt.links.new(bsdf.outputs[0], both.inputs[1])
    nt.links.new(thin.outputs[0], both.inputs[2])
    nt.links.new(both.outputs[0], out.inputs['Surface'])
    me.materials.append(m)
    return ob


def detail_modifier(ob, rock, tuft):
    """Geometry Nodes on the terrain: push the steep faces out into crags and stepped beds of
    rock, and strew boulders over the scree. The masks come from build_terrain."""
    ng = bpy.data.node_groups.new('Terrain detail', 'GeometryNodeTree')
    for io in ('INPUT', 'OUTPUT'):
        ng.interface.new_socket('Geometry', in_out=io, socket_type='NodeSocketGeometry')
    L = ng.links.new

    def new(kind, **props):
        return node(ng, kind, (0, 0), **props)

    def attr(name):
        return live(new('GeometryNodeInputNamedAttribute', data_type='FLOAT', Name=name).outputs, 'Attribute')

    def tex(kind, scale, detail):
        n = new('ShaderNodeTexNoise', noise_type=kind, Scale=scale, Detail=detail, Roughness=0.55)
        L(pos, n.inputs['Vector'])
        return n.outputs[0]

    pos = new('GeometryNodeInputPosition').outputs[0]
    z = new('ShaderNodeSeparateXYZ')
    L(pos, z.inputs[0])
    # beds of rock: soft waves that follow the height, so the wall swells and dips in layers.
    # Both are rounded and scaled to the mesh: anything sharper than a few cells turns to spikes
    fine = min(1.0, RES / FULL)
    ledge = calc(ng, 'SINE', calc(ng, 'ADD', calc(ng, 'MULTIPLY', z.outputs['Z'], 18.0), calc(ng, 'MULTIPLY', tex('FBM', 0.5, 2.0), 12.0)))
    crags = remap(ng, tex('FBM', 1.6, 1.0), 0.3, 0.7, (-0.5, 0.5))
    crags.node.interpolation_type = 'SMOOTHSTEP'
    amount = calc(ng, 'MULTIPLY', attr('crag'), calc(ng, 'ADD', calc(ng, 'MULTIPLY', crags, 0.07 * fine), calc(ng, 'MULTIPLY', ledge, 0.025 * fine)))
    push = new('ShaderNodeVectorMath', operation='SCALE')
    L(new('GeometryNodeInputNormal').outputs[0], push.inputs[0])
    L(amount, push.inputs['Scale'])
    move = new('GeometryNodeSetPosition')
    L(new('NodeGroupInput').outputs[0], move.inputs['Geometry'])
    L(push.outputs[0], move.inputs['Offset'])

    join = new('GeometryNodeJoinGeometry')
    L(move.outputs[0], join.inputs[0])

    def strew(what, density, size, tilt):
        spots = new('GeometryNodeDistributePointsOnFaces')
        L(move.outputs[0], spots.inputs['Mesh'])
        L(density, spots.inputs['Density'])
        info = new('GeometryNodeObjectInfo')
        info.inputs['Object'].default_value = what
        info.inputs['As Instance'].default_value = True
        turn = new('FunctionNodeRandomValue', data_type='FLOAT_VECTOR')
        live(turn.inputs, 'Max').default_value = (tilt, tilt, 6.3)
        put = new('GeometryNodeInstanceOnPoints')
        L(spots.outputs['Points'], put.inputs['Points'])
        L(info.outputs['Geometry'], put.inputs['Instance'])
        L(live(turn.outputs, 'Value'), put.inputs['Rotation'])
        L(size, put.inputs['Scale'])
        L(put.outputs[0], join.inputs[0])

    def chance():
        return live(new('FunctionNodeRandomValue', data_type='FLOAT').outputs, 'Value')

    # boulders: mostly pebbles, now and then a real one
    strew(rock, calc(ng, 'MULTIPLY', attr('scree'), 45.0), calc(ng, 'ADD', calc(ng, 'MULTIPLY', calc(ng, 'POWER', chance(), 4.0), 0.07), 0.012), 6.3)
    # tufts of grass on the gentle ground around the mountain, thinning out with distance
    strew(tuft, calc(ng, 'MULTIPLY', attr('turf'), 320.0), calc(ng, 'ADD', calc(ng, 'MULTIPLY', chance(), 0.04), 0.035), 0.25)
    L(join.outputs[0], new('NodeGroupOutput').inputs[0])
    ob.modifiers.new('Detail', 'NODES').node_group = ng


# ---------- path, climber and stops ----------


def path_xy():
    """The spiral from the valley to the summit, same shape as the 3D scene in mountain.js."""
    t = np.linspace(0, 1, 2400)
    a = -2.55 + t * 3.4
    rad = 7.2 * (1 - t) ** 1.1 + 0.05
    # three.js x/z -> Blender x/-y; the peak sits at three z = -1, Blender y = 1
    return PEAK.x + np.cos(a) * rad, PEAK.y - np.sin(a) * rad


def path_points():
    x, y = path_xy()
    return np.stack([x, y, ground(x, y) + 0.09], -1)


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
    # the fifth stop is the summit itself: no marker there, the climber arriving says enough
    for i in range(1, 5):
        k = 0.06 + (i - 1) * 0.188
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
        el = math.radians(4.0 + k * 31)
        sky.sun_elevation = el
        sky.sun_rotation = (math.pi / 2 - az) % (2 * math.pi)
        sky.keyframe_insert('sun_elevation', frame=f)
        sky.keyframe_insert('sun_rotation', frame=f)
        toward = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sun.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()
        sun.data.energy = 2.0 + k * 1.6
        sun.data.color = (1.0, 0.8 + 0.15 * k, 0.6 + 0.3 * k)  # golden early on, whiter as it climbs
        sun.data.keyframe_insert('color', frame=f)
        bg.inputs['Strength'].default_value = 0.4 - k * 0.3
        bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
        sun.keyframe_insert('rotation_euler', frame=f)
        sun.data.keyframe_insert('energy', frame=f)


def setup_render(samples, scale):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.use_persistent_data = True  # the land does not move: build it once for all frames
    sc.render.resolution_percentage = scale
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.quality = 80
    sc.frame_start, sc.frame_end = 0, COUNT - 1
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = -0.35  # a touch darker keeps the greens rich
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
    bpy.data.orphans_purge(do_recursive=True)  # a rerun in the same session starts clean
    build_terrain()
    build_path(path_points())


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    opt = {argv[i].lstrip('-'): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
    set_ = opt.get('render', 'l')
    global RES
    RES = int(opt.get('res', RES))
    import addon_utils

    addon_utils.enable('cycles')
    build()
    build_camera_and_light(set_)
    setup_render(int(opt.get('samples', 128)), int(opt.get('scale', 100)))
    sc = bpy.context.scene
    sc.frame_set(0)
    if 'save' in opt:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt['save']))
    if 'render' not in opt:
        return
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.abspath(opt.get('out', os.path.join(root, 'public', 'berg', set_)))
    os.makedirs(out, exist_ok=True)
    frames = [int(f) for f in opt['only'].split(',')] if 'only' in opt else range(COUNT)
    for f in frames:
        sc.frame_set(f)
        sc.render.filepath = os.path.join(out, f'{f:03d}')
        bpy.ops.render.render(write_still=True)


main()
