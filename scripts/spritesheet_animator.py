bl_info = {
    "name": "Spritesheet Animator",
    "author": "100SideDice",
    "version": (1, 1),
    "blender": (3, 0, 0),
    "location": "View3D > Sidebar > SpriteSheet Anim",
    "category": "Animation"
}

import bpy
import ast


def get_mapping_node(mat):
    """Return a Mapping node, creating one if missing."""
    nt = mat.node_tree

    # Check existing nodes
    for n in nt.nodes:
        if n.type == "MAPPING":
            return n

    # Create one
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.vector_type = 'POINT'
    mapping.location = (-300, 0)

    # Find an Image Texture node to reconnect
    tex = None
    for n in nt.nodes:
        if n.type == "TEX_IMAGE":
            tex = n
            break

    if tex:
        # Insert mapping between UV and Texture
        # Try to find UV input
        uv = None
        for n in nt.nodes:
            if n.type == "UVMAP":
                uv = n
                break

        if uv:
            nt.links.new(uv.outputs["UV"], mapping.inputs["Vector"])
        else:
            # fallback use texture UV input
            nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])

    return mapping


class SPRITE_OT_paste_animation(bpy.types.Operator):
    bl_idname = "sprite.paste_animation"
    bl_label = "Paste Animation"
    bl_description = "Paste the selected spritesheet animation at current frame"

    anim: bpy.props.StringProperty()

    def execute(self, context):
        props = context.scene.sprite_anim_props
        obj = context.active_object
        if not obj or obj.type != 'MESH':
            self.report({'ERROR'}, "Select a mesh object.")
            return {'CANCELLED'}

        # Parse animation dictionary
        try:
            anim_dict = ast.literal_eval(props.anim_dict)
        except:
            self.report({'ERROR'}, "Invalid animation dictionary.")
            return {'CANCELLED'}

        if self.anim not in anim_dict:
            self.report({'ERROR'}, f"No animation named {self.anim}")
            return {'CANCELLED'}

        frames, fps = anim_dict[self.anim]
        start_frame = context.scene.frame_current

        mat = obj.active_material
        if not mat or not mat.use_nodes:
            self.report({'ERROR'}, "Material must use nodes.")
            return {'CANCELLED'}

        mapping = get_mapping_node(mat)
        if not mapping:
            self.report({'ERROR'}, "Couldn't create/find a Mapping node.")
            return {'CANCELLED'}

        row_index = list(anim_dict.keys()).index(self.anim)

        fw = props.frame_width
        fh = props.frame_height
        fpr = props.frames_per_row

        sheet_w = fw * fpr
        sheet_h = fh * len(anim_dict)

        # Per-frame UV shift (normalized 0-1 UVs)
        du = fw / sheet_w
        dv = fh / sheet_h

        scene_fps = context.scene.render.fps
        frames_per_anim_frame = scene_fps / fps

        for i in range(frames):
            frame = int(start_frame + i * frames_per_anim_frame)
            col = i % fpr

            u = col * du
            v = 1.0 - (row_index + 1) * dv

            mapping.inputs["Location"].default_value[0] = u
            mapping.inputs["Location"].default_value[1] = v

            mapping.inputs["Location"].keyframe_insert("default_value", frame=frame)

            # ---- IMPORTANT: Force “stepped / constant” interpolation ----
            action = mapping.id_data.animation_data.action
            for fcurve in action.fcurves:
                for kp in fcurve.keyframe_points:
                    kp.interpolation = 'CONSTANT'



        return {'FINISHED'}


class SPRITE_PT_panel(bpy.types.Panel):
    bl_label = "SpriteSheet Anim"
    bl_idname = "SPRITE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "SpriteSheet Anim"

    def draw(self, context):
        layout = self.layout
        props = context.scene.sprite_anim_props

        layout.prop(props, "frame_width")
        layout.prop(props, "frame_height")
        layout.prop(props, "frames_per_row")
        layout.prop(props, "anim_dict")

        try:
            anim_dict = ast.literal_eval(props.anim_dict)
            for anim in anim_dict:
                layout.operator("sprite.paste_animation", text=f"Paste: {anim}").anim = anim
        except:
            layout.label(text="Invalid animation dict", icon="ERROR")


class SPRITE_AnimProps(bpy.types.PropertyGroup):
    frame_width: bpy.props.IntProperty(name="Frame Width", default=64)
    frame_height: bpy.props.IntProperty(name="Frame Height", default=64)
    frames_per_row: bpy.props.IntProperty(name="Frames per Row", default=8)
    anim_dict: bpy.props.StringProperty(
        name="Animations",
        default='{"Idle": (4, 12), "Run": (6, 18)}'
    )


classes = (
    SPRITE_AnimProps,
    SPRITE_OT_paste_animation,
    SPRITE_PT_panel,
)

def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.sprite_anim_props = bpy.props.PointerProperty(type=SPRITE_AnimProps)

def unregister():
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
    del bpy.types.Scene.sprite_anim_props

if __name__ == "__main__":
    register()
