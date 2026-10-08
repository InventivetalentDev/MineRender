# Scene editor

Compose mixed MineRender scenes at `/editor/`. From the repository root, run
`yarn dev:web`, then open `http://127.0.0.1:3000/editor/`.

## Edit a scene

1. Choose an object type, enter an asset ID or skin source, and select **Add to scene**.
2. Select the object in the viewport or **Objects** list. Use **Move**, **Rotate**, or
   **Scale**, or enter values in **Object properties**. Positions use 16 units per
   block; the inspector shows rotation in degrees.
3. Edit the selected object's controls: blockstate properties, item display poses,
   skin parts, poses, and capes, entity layers and animation playback, or GUI layers.
4. Select **Save JSON** to download an editable scene. **Use in code** provides a
   loader example for the same document.

**Snap** uses 16-unit position steps, 15-degree rotation steps, and 0.25 scale steps.
**Frame** fits the selected object, or the whole scene when nothing is selected.
The W, E, R, and F shortcuts select these tools. Ctrl/Cmd+Z undoes an edit;
Ctrl/Cmd+Shift+Z redoes it. Undo retains up to 50 scene states.

Edits save to browser storage. **Restore last local save** loads that scene after
reopening the page. **New** starts an empty scene and can be undone. Downloads remain
available when browser storage is unavailable or full.

## Import and export

**Import** accepts scene JSON, Java structure `.nbt`, and legacy Alpha `.schematic`.
Scene JSON replaces the scene after every object loads successfully. Structure
files append up to 2,048 non-air blocks as individually editable objects, preserving
blockstates and positions. Structure imports use the first palette and omit entity
and block-entity NBT and DataVersion. Sponge `.schem` and Anvil `.mca` imports are not
part of this editor.

**Export** writes PNG images or static GLB, glTF, OBJ, and PLY snapshots. Editor
handles, selection bounds, and the grid are excluded. PNG uses the viewport size;
enable **Transparent background** to preserve alpha. OBJ and PLY omit texture images.
Static model exports cannot be imported back as editable MineRender scene documents.

JSON stores asset IDs, transforms, exposed options, animation settings, and camera
position/target. Local skin and cape PNG imports are embedded as data URLs; remote
textures remain URLs. Weighted block model alternatives are selected again on load.
The document does not include custom resource packs, editor tool settings, arbitrary
JavaScript, or user-authored geometry. GUI layers use a JSON field for their ordered
texture, item, and text definitions.
