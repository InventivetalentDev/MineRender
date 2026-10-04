import { Materials, shutdown } from "minerender";
import * as THREE from "three";

window["materialTest"] = (async () => {
    const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#23c4cf"; context.fillRect(0, 0, 16, 16);
    context.fillStyle = "#17445c"; context.fillRect(0, 0, 8, 8); context.fillRect(8, 8, 8, 8);
    const material = Materials.createShadedCanvasMaterial(canvas) as THREE.ShaderMaterial;
    const geometry = new THREE.BoxGeometry(1.2, 0.7, 1);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(160, 160);
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        throw new Error(gl.getShaderInfoLog(vertex) || gl.getShaderInfoLog(fragment) || "Shader compilation failed");
    };
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(3, 2, 4); camera.lookAt(0, 0, 0);
    const transforms = [new THREE.Matrix4(), new THREE.Matrix4().compose(
        new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.7, -0.1)),
        new THREE.Vector3(1.6, 1.6, 1.6))];
    const results = [], differences = [];
    try {
        for (const [index, transform] of transforms.entries()) {
            const pair = [];
            for (const instanced of [false, true]) {
                const label = `${index === 0 ? "Identity" : "Rotated and scaled"} · ${instanced ? "InstancedMesh" : "Mesh"}`;
                const mesh = instanced ? new THREE.InstancedMesh(geometry, material, 1) : new THREE.Mesh(geometry, material);
                if (mesh instanceof THREE.InstancedMesh) mesh.setMatrixAt(0, transform);
                else { mesh.matrixAutoUpdate = false; mesh.matrix.copy(transform); }
                const scene = new THREE.Scene(); scene.add(mesh);
                renderer.render(scene, camera);
                const gl = renderer.getContext(), pixels = new Uint8Array(160 * 160 * 4);
                gl.readPixels(0, 0, 160, 160, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                assert(gl.getError() === gl.NO_ERROR, `${label}: WebGL error`);
                let visible = 0;
                const colors = new Set();
                for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
                    visible++; colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
                }
                assert(visible > 100 && colors.size > 2, `${label}: missing geometry or texture detail`);
                const figure = document.createElement("figure"), image = document.createElement("img");
                image.src = renderer.domElement.toDataURL(); image.alt = label;
                const caption = document.createElement("figcaption"); caption.textContent = label;
                figure.append(image, caption); document.getElementById("renders")!.append(figure);
                pair.push(pixels); results.push({ label, visible, colors: colors.size });
                if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
            }
            const difference = pair[0].reduce((total, value, i) => total + Math.abs(value - pair[1][i]), 0) / pair[0].length;
            differences.push(difference);
            assert(difference <= 0.25, `Transform ${index}: Mesh and InstancedMesh pixels differ (${difference})`);
        }
        document.getElementById("status")!.textContent = "PASS: both mesh types render matching textures and shading for both transforms.";
        return { passed: true, results, differences };
    } finally {
        material.uniforms.map.value.dispose(); material.dispose(); geometry.dispose(); renderer.dispose();
        shutdown();
    }
})().catch(error => {
    document.getElementById("status")!.textContent = `FAIL: ${error.message}`;
    return { passed: false, error: error.message };
});
