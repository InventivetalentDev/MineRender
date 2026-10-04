import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.Bootstrap;
import net.minecraft.client.model.Model;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.block.entity.BlockEntityRenderDispatcher;
import net.minecraft.client.render.block.entity.ShulkerBoxBlockEntityRenderer;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.render.entity.model.ShulkerEntityModel;
import net.minecraft.entity.EntityType;
import net.minecraft.resource.ReloadableResourceManagerImpl;
import net.minecraft.resource.ResourceType;
import net.minecraft.util.registry.Registry;

public final class ExtractModelDumps {
    // These registrations match Minecraft 1.16.5's BlockEntityRenderDispatcher constructor.
    // Keeping the list here avoids initializing its game-dependent, non-model renderers.
    private static final Map<String, String> BLOCK_RENDERERS = Map.ofEntries(
        Map.entry("sign", "SignBlockEntityRenderer"),
        Map.entry("mob_spawner", "MobSpawnerBlockEntityRenderer"),
        Map.entry("piston", "PistonBlockEntityRenderer"),
        Map.entry("chest", "ChestBlockEntityRenderer"),
        Map.entry("ender_chest", "ChestBlockEntityRenderer"),
        Map.entry("trapped_chest", "ChestBlockEntityRenderer"),
        Map.entry("enchanting_table", "EnchantingTableBlockEntityRenderer"),
        Map.entry("lectern", "LecternBlockEntityRenderer"),
        Map.entry("end_portal", "EndPortalBlockEntityRenderer"),
        Map.entry("end_gateway", "EndGatewayBlockEntityRenderer"),
        Map.entry("beacon", "BeaconBlockEntityRenderer"),
        Map.entry("skull", "SkullBlockEntityRenderer"),
        Map.entry("banner", "BannerBlockEntityRenderer"),
        Map.entry("structure_block", "StructureBlockBlockEntityRenderer"),
        Map.entry("shulker_box", "ShulkerBoxBlockEntityRenderer"),
        Map.entry("bed", "BedBlockEntityRenderer"),
        Map.entry("conduit", "ConduitBlockEntityRenderer"),
        Map.entry("bell", "BellBlockEntityRenderer"),
        Map.entry("campfire", "CampfireBlockEntityRenderer")
    );

    public static void main(String[] args) throws Exception {
        if (args.length != 1 || args[0].isBlank()) {
            throw new IllegalArgumentException("Usage: ExtractModelDumps OUTPUT_DIRECTORY");
        }
        Path output = Path.of(args[0]).toAbsolutePath().normalize();
        if (Files.exists(output, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("Output already exists: " + output);
        }
        requireVersion();
        Bootstrap.initialize();

        JsonObject entities;
        try (ReloadableResourceManagerImpl resources = new ReloadableResourceManagerImpl(ResourceType.CLIENT_RESOURCES)) {
            // Model constructors register reload listeners but do not load textures or render frames.
            EntityRenderDispatcher dispatcher = new EntityRenderDispatcher(null, null, resources, null, null);
            entities = entityModels(dispatcher);
        }
        JsonObject blocks = blockEntityModels();
        Gson gson = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
        String entityJson = gson.toJson(entities) + "\n";
        String blockJson = gson.toJson(blocks) + "\n";

        Files.createDirectories(output.getParent());
        Files.createDirectory(output);
        Files.writeString(output.resolve("entityModels.json"), entityJson, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        Files.writeString(output.resolve("blockEntityModels.json"), blockJson, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        System.out.println("Extracted " + entities.size() + " entities and " + blocks.size() + " block entities to " + output);
    }

    private static void requireVersion() throws Exception {
        try (InputStream input = Bootstrap.class.getResourceAsStream("/version.json")) {
            if (input == null) {
                throw new IllegalStateException("Minecraft client version.json is missing from the classpath");
            }
            JsonObject version = new JsonParser().parse(new InputStreamReader(input, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!"1.16.5".equals(version.get("id").getAsString())) {
                throw new IllegalStateException("This extractor requires Minecraft 1.16.5 with Yarn 1.16.5+build.6 mappings");
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static JsonObject entityModels(EntityRenderDispatcher dispatcher) throws Exception {
        Map<EntityType<?>, Object> renderers = (Map<EntityType<?>, Object>) field(dispatcher, "renderers");
        Map<String, Object> sorted = new TreeMap<>();
        for (Map.Entry<EntityType<?>, Object> entry : renderers.entrySet()) {
            sorted.put(Registry.ENTITY_TYPE.getId(entry.getKey()).toString(), entry.getValue());
        }
        JsonObject result = new JsonObject();
        for (Map.Entry<String, Object> entry : sorted.entrySet()) {
            JsonObject parts = new JsonObject();
            extractModels(entry.getValue(), parts);
            result.add(entry.getKey(), parts);
        }
        return result;
    }

    private static JsonObject blockEntityModels() throws Exception {
        JsonObject result = new JsonObject();
        for (Map.Entry<String, String> entry : new TreeMap<>(BLOCK_RENDERERS).entrySet()) {
            Class<?> rendererClass = Class.forName(
                "net.minecraft.client.render.block.entity." + entry.getValue(), false, ExtractModelDumps.class.getClassLoader()
            );
            JsonObject parts = new JsonObject();
            if (fields(rendererClass).stream().anyMatch(ExtractModelDumps::isModelField)) {
                Object renderer;
                if (rendererClass == ShulkerBoxBlockEntityRenderer.class) {
                    renderer = new ShulkerBoxBlockEntityRenderer(new ShulkerEntityModel<>(), null);
                } else {
                    renderer = rendererClass.getConstructor(BlockEntityRenderDispatcher.class).newInstance(new Object[] { null });
                }
                extractModels(renderer, parts);
            }
            result.add("minecraft:" + entry.getKey(), parts);
        }
        return result;
    }

    private static boolean isModelField(Field field) {
        return field.getType() == ModelPart.class || Model.class.isAssignableFrom(field.getType());
    }

    private static void extractModels(Object container, JsonObject parts) throws Exception {
        // Preserve the original extractor's traversal: direct ModelPart fields and nested Models.
        // Arrays, collections, and feature renderers stay excluded so the historical dumps can be reproduced.
        for (Field field : fields(container.getClass())) {
            if (!isModelField(field)) continue;
            field.setAccessible(true);
            Object value = field.get(container);
            if (value == null) {
                throw new IllegalStateException("Model field is null: " + field);
            }
            if (field.getType() == ModelPart.class) {
                parts.add(field.getName(), modelPart((ModelPart) value));
            } else {
                extractModels(value, parts);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static JsonObject modelPart(ModelPart part) throws Exception {
        JsonObject result = new JsonObject();
        for (String name : List.of("textureWidth", "textureHeight", "textureOffsetU", "textureOffsetV",
                "pivotX", "pivotY", "pivotZ", "pitch", "yaw", "roll")) {
            result.addProperty(name, (Number) field(part, name));
        }
        result.addProperty("mirror", part.mirror);
        JsonArray cubes = new JsonArray();
        for (ModelPart.Cuboid cube : (Iterable<ModelPart.Cuboid>) field(part, "cuboids")) {
            JsonObject bounds = new JsonObject();
            bounds.addProperty("minX", cube.minX);
            bounds.addProperty("minY", cube.minY);
            bounds.addProperty("minZ", cube.minZ);
            bounds.addProperty("maxX", cube.maxX);
            bounds.addProperty("maxY", cube.maxY);
            bounds.addProperty("maxZ", cube.maxZ);
            cubes.add(bounds);
        }
        result.add("cubes", cubes);
        JsonArray children = new JsonArray();
        for (ModelPart child : (Iterable<ModelPart>) field(part, "children")) {
            children.add(modelPart(child));
        }
        result.add("children", children);
        return result;
    }

    private static List<Field> fields(Class<?> type) {
        List<Field> result = new ArrayList<>();
        for (Class<?> current = type; current != Object.class; current = current.getSuperclass()) {
            result.addAll(Arrays.asList(current.getDeclaredFields()));
        }
        return result;
    }

    private static Object field(Object target, String name) throws ReflectiveOperationException {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }
}
