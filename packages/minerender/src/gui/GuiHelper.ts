export class GuiHelper {

    public static inventorySlot(slot: number | [number, number], origin: [number, number] = [0, 0], offset: [number, number] = [18, 18], rowSize: number = 9): [number, number] {
        const [column, row] = typeof slot === "number" ? [slot % rowSize, Math.floor(slot / rowSize)] : slot;
        return [origin[0] + column * offset[0], origin[1] + row * offset[1]];
    }

}
