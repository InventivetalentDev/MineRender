// Kept free of imports: AssetLoader reads DEFAULT_ROOT in a static initializer, and Assets.ts sits in an import
// cycle with AssetLoader, so code-split bundles could run that initializer before the constant was assigned.
export const DEFAULT_ROOT = "https://assets.mcasset.cloud/1.21.11";
export const DEFAULT_NAMESPACE = "minecraft";
