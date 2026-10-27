# Blender batch converter: FBX -> optimized GLB for the web scene.
# usage: blender -b -P convert.py -- <in.fbx> <out.glb> <texdir> <mode: env|char> [maxTex]
import bpy, sys, os, re
argv = sys.argv[sys.argv.index("--")+1:]
src, out, texdir, mode = argv[:4]
max_tex = int(argv[4]) if len(argv) > 4 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
bpy.context.scene.frame_set(1)

def norm(s):
    s = os.path.splitext(os.path.basename(s))[0].lower()
    s = re.sub(r'\.\d{3}$', '', s)
    return re.sub(r'[^a-z0-9]', '', s)
files = {norm(f): os.path.join(texdir, f) for f in os.listdir(texdir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))}
for img in list(bpy.data.images):
    if img.size[0] > 0: continue
    key = norm(img.filepath or img.name)
    hit = files.get(key) or next((p for k, p in files.items() if key and (key in k or k in key)), None)
    if hit:
        img.filepath = hit; img.reload()
        print("RELINK", img.name, "->", os.path.basename(hit))
    else:
        print("MISSING", img.name)
for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        f = max_tex / max(img.size[0], img.size[1])
        img.scale(max(1, int(img.size[0]*f)), max(1, int(img.size[1]*f)))
        img.pack()

if mode == 'env':
    total = 0
    done = {}
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        me = o.data
        if me.name in done:
            o.data = done[me.name]
        else:
            n = len(me.polygons)
            if n > 4000:
                users = [u for u in bpy.data.objects if u.data == me]
                o.data = me.copy()
                target = min(40000, max(4000, n * 0.12))
                m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = target / n
                bpy.context.view_layer.objects.active = o
                for s in bpy.context.selected_objects: s.select_set(False)
                o.select_set(True)
                bpy.ops.object.modifier_apply(modifier='dec')
                for u in users: u.data = o.data
                done[o.data.name] = o.data
            done[me.name] = o.data
        total += len(o.data.polygons)
    print("FACES_AFTER", total)

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=False,
                          export_image_format='AUTO', export_apply=True, export_yup=True)
print("WROTE", out, os.path.getsize(out))
