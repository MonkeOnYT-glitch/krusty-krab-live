import bpy, sys, collections
argv = sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])
meshes=[o for o in bpy.data.objects if o.type=='MESH']
tot=sum(len(o.data.polygons) for o in meshes)
print("OBJECTS", len(bpy.data.objects), "MESHES", len(meshes), "FACES", tot)
import mathutils
mn=[1e9]*3; mx=[-1e9]*3
for o in meshes:
    for c in o.bound_box:
        w=o.matrix_world @ mathutils.Vector(c)
        for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
print("BOUNDS", [round(v,1) for v in mn], [round(v,1) for v in mx])
for o in sorted(meshes, key=lambda o:-len(o.data.polygons))[:45]:
    w=o.matrix_world.translation
    print("  %-40s %8d  dims=%s at=%s mats=%s" % (o.name[:40], len(o.data.polygons), [round(v,1) for v in o.dimensions], [round(v,1) for v in w], [m.name[:18] for m in o.data.materials][:3]))
print("IMGS", [(i.name, i.size[:]) for i in bpy.data.images])
