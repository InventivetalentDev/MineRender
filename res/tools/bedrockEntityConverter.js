const fs = require("fs");

const IN = "./mobs.json";
const OUT = "./convertedMobs/";

fs.readFile(IN, (err, data) => {
    let json = JSON.parse(data);

    for (let g in json) {
        if (json.hasOwnProperty(g)) {
            let geo = json[g];
            let convertedGeo = {
                groups: {}
            };

            convertedGeo.name = g;
            if (convertedGeo.name.indexOf(":") !== -1) {
                let split = convertedGeo.name.split(":");
                convertedGeo.name = split[0];
                convertedGeo.parent = split[1];
            }
            convertedGeo.name = convertedGeo.name.substr("geometry.".length);
            if (convertedGeo.parent) convertedGeo.parent = convertedGeo.parent.substr("geometry.".length);


            for (let b in geo.bones) {
                if (geo.bones.hasOwnProperty(b)) {
                    let bone = geo.bones[b];
                    let convertedBone = {
                        name: bone.name,
                        pivot: bone.pivot,
                        rotation: bone.rotation,
                        mirror: bone.mirror,
                        pos: bone.pos,
                        parent: bone.parent,
                        material: bone.material,
                        cubes: []
                    };

                    for (let c in bone.cubes) {
                        if (bone.cubes.hasOwnProperty(c)) {
                            let cube = bone.cubes[c];
                            let convertedCube = {
                                origin: cube.origin,
                                size: cube.size,
                                mirror: cube.mirror,
                                inflate: cube.inflate,
                                uv: {}
                            };

                            convertedCube.uv["left"] = [
                                cube.uv[0],
                                cube.uv[1] + cube.size[2],
                                cube.uv[0] + cube.size[2],
                                cube.uv[1] + cube.size[2] + cube.size[1]
                            ];
                            convertedCube.uv["right"] = [
                                cube.uv[0] + cube.size[2] + cube.size[0],
                                cube.uv[1] + cube.size[2],
                                cube.uv[0] + cube.size[2] + cube.size[0] + cube.size[2],
                                cube.uv[1] + cube.size[2] + cube.size[1]
                            ];
                            convertedCube.uv["top"] = [
                                cube.uv[0] + cube.size[2],
                                cube.uv[1],
                                cube.uv[0] + cube.size[2] + cube.size[0],
                                cube.uv[1] + cube.size[2]
                            ];
                            convertedCube.uv["bottom"] = [
                                cube.uv[0] + cube.size[2] + cube.size[0],
                                cube.uv[1],
                                cube.uv[0] + cube.size[2] + cube.size[0] + cube.size[0],
                                cube.uv[1] + cube.size[2]
                            ];
                            convertedCube.uv["front"] = [
                                cube.uv[0] + cube.size[2],
                                cube.uv[1] + cube.size[2],
                                cube.uv[0] + cube.size[2] + cube.size[0],
                                cube.uv[1] + cube.size[2] + cube.size[1]
                            ];
                            convertedCube.uv["back"] = [
                                cube.uv[0] + cube.size[2] + cube.size[0] + cube.size[2],
                                cube.uv[1] + cube.size[2],
                                cube.uv[0] + cube.size[2] + cube.size[0] + cube.size[2] + cube.size[0],
                                cube.uv[1] + cube.size[2] + cube.size[1]
                            ];

                            convertedBone.cubes.push(convertedCube);
                        }
                    }

                    convertedGeo.groups[bone.name] = convertedBone;
                }
            }

            fs.writeFile(OUT + convertedGeo.name + ".json", JSON.stringify(convertedGeo, null, 2), (err) => {
                if (err)
                    console.warn(err);
            })
        }
    }
});