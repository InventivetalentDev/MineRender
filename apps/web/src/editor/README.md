# Scene editor

Compose mixed MineRender scenes at `/editor/`. From the repository root, run
`yarn dev:web`, then open `http://127.0.0.1:3000/editor/`.

## Edit a scene

1. Choose an object type, enter an asset ID or skin source, and select **Add to scene**.
2. Select the object in the viewport or **Objects** list. Use **Move**, **Rotate**, or
   **Scale**, or enter values in **Object properties**. Positions use 16 units per
   block; the inspector shows rotation in degrees.
3. Edit the selected object's controls: blockstate properties, item display poses and
   item state, skin parts, poses, and capes, entity layers and animation playback, or
   GUI layers.
4. Select **Save JSON** to download an editable scene. **Use in code** provides a
   loader example for the same document.

**Snap** uses 16-unit position steps, 15-degree rotation steps, and 0.25 scale steps.
**Frame** fits the selected object, or the whole scene when nothing is selected.
The W, E, R, and F shortcuts select these tools. Ctrl/Cmd+Z undoes an edit;
Ctrl/Cmd+Shift+Z redoes it. Undo retains up to 50 scene states.

Edits save to browser storage and restore automatically when the page opens.
**Restore last local save** retries the restore. If it fails, new edits do not
overwrite the saved scene; use **Save JSON** to keep them until restore succeeds.
**New** starts an empty scene and can be undone. Downloads remain available when
browser storage is unavailable or full.

## Import and export

**Import** accepts scene JSON, Java structure `.nbt`, legacy Alpha `.schematic`,
Sponge `.schem` versions 2 and 3, and Litematica `.litematic` versions 5–7.
Scene JSON replaces the scene after every object loads successfully. Structure
files append up to 2,048 non-air blocks as individually editable objects, preserving
blockstates and positions, including Sponge offsets and the relative placement of
all Litematica subregions. Java structures use the first palette. Structure imports
omit entity and block-entity NBT, DataVersion, and subregion names. Anvil
`.mca` imports are not part of this editor.

**Export** writes PNG images, videos, or static GLB, glTF, OBJ, and PLY snapshots.
Editor handles, selection bounds, and the grid are excluded. PNG uses the viewport
size; enable **Transparent background** to preserve alpha. Video records the viewport
in real time for the chosen duration and frame rate, without audio and with black in
place of transparent pixels; the browser picks WebM or MP4. OBJ and PLY omit texture
images. Static model exports cannot be imported back as editable MineRender scene
documents.

JSON stores asset IDs, transforms, exposed options, item state, animation settings,
and camera position/target. Local skin and cape PNG imports are embedded as data URLs; remote
textures remain URLs. Weighted block model alternatives are selected again on load.
The document does not include custom resource packs, editor tool settings, arbitrary
JavaScript, or user-authored geometry.

Use **GUI layers** to add, edit, reorder, or remove texture, item, and text layers,
or to insert the layers of a chest background, boss bar, book page, or tooltip. The
controls expose positions, sizes, and each layer's content, including an item layer's
state. **Advanced layers JSON** edits the complete layer definitions, including
options without a control.

**Item state** on item objects and item layers supplies data components, item-model
properties, a stack count, and item references, as in `Models.getMerged`. Item
definitions use them to select models and tints; for example, `minecraft:dyed_color`
colors leather armor and `minecraft:banner_patterns` draws banner and shield patterns.
The display pose of an item object also selects its display context.
