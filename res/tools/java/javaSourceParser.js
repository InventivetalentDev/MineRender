const fs = require("fs");
const path = require("path");
const japa = require("java-parser");

const IN = "./in/";
const OUT = "./out/";

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

        try {
            let model = {
                name: "n/a",
                groups: {}
            };

            let parsed = japa.parse(data.toString("utf8"));

            // Root should be 'CompilationUnit' with the 'type' array containing the files classes
            if (parsed.node !== "CompilationUnit") {
                return console.warn("Root is not 'CompilationUnit'")
            }
            if (!parsed.hasOwnProperty("types") || parsed.types.length === 0) {
                return console.warn("Missing/Empty 'types' array in root");
            }

            /// Parse class
            // Model class files should only contain a single class
            let modelType = parsed.types[0];

            if (!modelType.hasOwnProperty("name")) {
                return console.warn("Missing name in class");
            }
            if (!modelType.name.identifier.startsWith("Model")) {
                console.warn("Class name does not begin with 'Model'")
            }
            if (modelType.interface) {
                return;
            }
            let isAbstract = false;
            for (let j = 0; j < modelType.modifiers.length; j++) {
                if (modelType.modifiers[j].keyword === "abstract") isAbstract = true;
            }
            if (isAbstract) {
                return;
            }

            if (modelType.name.identifier === "ModelBiped" || modelType.name.identifier === "ModelBox") {
                return;
            }

            // Class name -> entity name
            model._name = modelType.name.identifier;
            model.name = modelType.name.identifier.substr("Model".length).toLowerCase();

            console.log("  ");
            console.log("=> " + model._name)

            /// Parse body
            for (let i = 0; i < modelType.bodyDeclarations.length; i++) {
                let declaration = modelType.bodyDeclarations[i];

                if (declaration.node === "FieldDeclaration") {
                    continue;// new field creation -> ignore
                }

                if (declaration.constructor) {// This is the interesting part, since the model is initialized in the class constructor

                    let localVars = {};

                    for (let j = 0; j < declaration.body.statements.length; j++) {
                        let statement = declaration.body.statements[j];

                        // Field assignment etc.
                        if (statement.node === "ExpressionStatement") {
                            console.log("ExpressionStatement")
                            let left = statement.expression.leftHandSide;
                            let right = statement.expression.rightHandSide;

                            if (left && right) {
                                if (left.node === "FieldAccess" || left.node === "ArrayAccess") {
                                    let fieldName = left.node === "FieldAccess" ? left.name.identifier : left.array.name.identifier;
                                    if (left.node === "ArrayAccess") {
                                        fieldName += "_" + left.index.token;
                                    }
                                    console.log("  FieldAccess " + fieldName);
                                    let group = getGroup(model, fieldName);

                                    if (statement.expression.node === "Assignment") {
                                        if (right.node === "ClassInstanceCreation") {
                                            if (right.type.name.identifier === "ModelRenderer") {
                                                // Create new group, since it's a new instance
                                                group = createGroup(model, fieldName);

                                                //arguments[0] = this
                                                group.texOffX = parseFloat(right.arguments[1].token);
                                                group.texOffY = parseFloat(right.arguments[2].token);
                                            }
                                        }
                                    }
                                }
                                if (left.node === "QualifiedName") {
                                    console.log("  QualifiedName " + left.qualifier.identifier)
                                    let group = getGroup(model, left.qualifier.identifier);
                                    if (!group) {
                                        group = localVars[left.qualifier.identifier];
                                    }

                                    let val = null;

                                    if (right.node === "BooleanLiteral") {
                                        val = right.booleanValue;
                                    }
                                    if (right.node === "NumberLiteral") {
                                        val = parseFloat(right.token);
                                    }

                                    group[left.name.identifier] = val;
                                }
                            }


                            // Method calls
                            if (statement.expression.node === "MethodInvocation") {
                                console.log(JSON.stringify(statement))

                                let methodName = statement.expression.name.identifier;
                                let fieldName =
                                    statement.expression.expression.node === "ArrayAccess"
                                        ? statement.expression.expression.array.name.identifier + "_" + statement.expression.expression.index.token
                                        : (statement.expression.expression.identifier || (statement.expression.expression.name ? statement.expression.expression.name.identifier : null));
                                console.log("  MethodInvocation " + fieldName + "." + methodName)

                                let group = getGroup(model, fieldName);
                                if (!group) {
                                    group = localVars[fieldName];
                                }

                                if (group) {
                                    if (methodName === "addBox") {
                                        let box = {
                                            _args: []
                                        };
                                        for (let k = 0; k < statement.expression.arguments.length; k++) {
                                            let arg = statement.expression.arguments[k];
                                            let num = parseArg(arg);

                                            if (k === 0) {
                                                box.offX = num;
                                            } else if (k === 1) {
                                                box.offY = num;
                                            } else if (k === 2) {
                                                box.offZ = num;
                                            } else if (k === 3) {
                                                box.width = num;
                                            } else if (k === 4) {
                                                box.height = num;
                                            } else if (k === 5) {
                                                box.depth = num;
                                            }

                                            box._args[k] = num;
                                        }
                                        if (!group.boxes) group.boxes = []
                                        group.boxes.push(box)
                                    }

                                    if (methodName === "addChild") {
                                        let child = statement.expression.arguments[0];
                                        if (child.node === "SimpleName") {
                                            let childName = child.identifier || child.name.identifier;
                                            let childData = localVars[childName];
                                            if (childData) {
                                                if (!group.children) group.children = [];
                                                group.children.push(childData);
                                            } else {
                                                console.warn("Missing local variable declaration '" + child.identifier + "'");
                                            }
                                        }
                                    }

                                    if (methodName === "setRotationPoint") {
                                        for (let k = 0; k < statement.expression.arguments.length; k++) {
                                            let arg = statement.expression.arguments[k];

                                            group.pivot[k] = parseArg(arg);
                                        }
                                    }

                                    if (methodName === "setTextureOffset") {
                                        if (!fieldName) {// Called on 'this'
                                            if (!model.textureOffsets) model.textureOffsets = {};
                                            model.textureOffsets[parseArg(statement.expression.arguments[0])] = [
                                                parseArg(statement.expression.arguments[1]),
                                                parseArg(statement.expression.arguments[2])
                                            ]
                                        }
                                    }
                                } else {
                                    console.warn("Method invocation with missing target group")
                                }
                            }
                        }

                        // Local variable declaration
                        if (statement.node === "VariableDeclarationStatement") {
                            console.log("VariableDeclarationStatement")
                            let fragment = statement.fragments[0];// Crossing fingers this will always be just 1 element
                            let varName = fragment.name.identifier;

                            if (statement.type.hasOwnProperty("name")) {
                                if (statement.type.name.identifier === "ModelRenderer") {
                                    localVars[varName] = {
                                        _type: "ModelRenderer",
                                        _varName: varName,
                                        texOffX: parseFloat(fragment.initializer.arguments[1].token),
                                        texOffY: parseFloat(fragment.initializer.arguments[2].token)
                                    };
                                }
                            }
                        }
                    }
                }
            }

            let fileName = model.name !== "n/a" ? model.name : Date.now().toString();
            fs.writeFile(OUT + fileName + ".json", JSON.stringify(model, null, 2), (err) => {
                if (err) console.error(err);
            })
        } catch (err) {
            console.error(err);
            console.log(file)
        }


    })
}

function parseArg(arg) {
    if (arg.node === "PrefixExpression") {
        return parseFloat(arg.operator + arg.operand.token);
    } else if (arg.node === "NumberLiteral") {
        return parseFloat(arg.token);
    } else if (arg.node === "StringLiteral") {
        return arg.escapedValue;
    }
}

function createGroup(model, name) {
    if (!model.groups.hasOwnProperty(name)) {
        model.groups[name] = {
            name: name,
            pivot: [],
            boxes: [],
            children: []
        }
    }

    return model.groups[name];
}

function getGroup(model, name) {
    return model.groups[name];
}