const fs = require("fs");
const path = require("path");
const japa = require("java-parser");

const IN = "./out/";
const OUT = "./finalOut/";


fs.readdir(IN, (err, files) => {
    if (err) return console.log(err);

    files.forEach((file, i) => {
        let filePath = path.join(IN, file);

        parseFile(filePath);
    })
});


function parseFile(file) {
    fs.readFile(file, (err, data) => {
        if (err) return console.log(err);
        data = JSON.parse(data);

        let parsed = {
            name: data.name,
            groups: {}
        }

        for (let g in data.groups) {
            if (data.groups.hasOwnProperty(g)) {
                let group = data.groups[g]
                let parsedGroup = {
                    name: group.name,
                    pivot: group.pivot,
                    rotation: [0,0,0],//TODO: rotation
                    cubes: []
                };

                for (let i = 0; i < group.boxes.length; i++) {
                    let box = group.boxes[i];
                    let parsedCube = {
                        origin: [],
                        size: [],
                        uv: {}
                    };
                    
                    parsedCube.origin=[
                        box.offX,
                        box.offY,
                        box.offZ
                    ];
                    parsedCube.size=[
                        box.width,
                        box.height,
                        box.depth
                    ];


                    parsedCube.uv["left"] = [
                        group.texOffX,
                        group.texOffY + parsedCube.size[2],
                        group.texOffX + parsedCube.size[2],
                        group.texOffY + parsedCube.size[2] + parsedCube.size[1]
                    ];
                    parsedCube.uv["right"] = [
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0],
                        group.texOffY + parsedCube.size[2],
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0] + parsedCube.size[2],
                        group.texOffY + parsedCube.size[2] + parsedCube.size[1]
                    ];
                    parsedCube.uv["top"] = [
                        group.texOffX + parsedCube.size[2],
                        group.texOffY,
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0],
                        group.texOffY + parsedCube.size[2]
                    ];
                    parsedCube.uv["bottom"] = [
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0],
                        group.texOffY,
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0] + parsedCube.size[0],
                        group.texOffY + parsedCube.size[2]
                    ];
                    parsedCube.uv["front"] = [
                        group.texOffX + parsedCube.size[2],
                        group.texOffY + parsedCube.size[2],
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0],
                        group.texOffY + parsedCube.size[2] + parsedCube.size[1]
                    ];
                    parsedCube.uv["back"] = [
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0] + parsedCube.size[2],
                        group.texOffY + parsedCube.size[2],
                        group.texOffX + parsedCube.size[2] + parsedCube.size[0] + parsedCube.size[2] + parsedCube.size[0],
                        group.texOffY + parsedCube.size[2] + parsedCube.size[1]
                    ];

                    parsedGroup.cubes.push(parsedCube)
                }

                parsed.groups[group.name] = parsedGroup;
            }
        }

        fs.writeFile(OUT + parsed.name + ".json", JSON.stringify(parsed, null, 2), (err) => {
            if (err) console.error(err);
        })
    });
}