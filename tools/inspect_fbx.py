import bpy, sys
argv = sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])
tot=0
for o in bpy.data.objects:
    n = len(o.data.polygons) if o.type=='MESH' else 0
    tot+=n
print("OBJECTS", len(bpy.data.objects), "FACES", tot)
for o in bpy.data.objects:
    if o.type in ('ARMATURE',) or (o.type=='MESH' and len(bpy.data.objects)<60):
        print(" ", o.type, o.name, o.parent.name if o.parent else "-", [round(v,2) for v in o.dimensions], len(o.data.polygons) if o.type=='MESH' else (len(o.data.bones)))
print("ACTIONS", [(a.name, a.frame_range[:]) for a in bpy.data.actions])
print("MATS", len(bpy.data.materials), "IMGS", [i.name for i in bpy.data.images][:30])
